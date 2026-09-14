#!/usr/bin/env bash
# Self-check for the dashboard's "start a run from 4 decks" feature
# (GET /api/decks, POST /api/runs) - both picking saved decks from the
# library and pasting fresh text that gets auto-saved for next time. Decks
# are Moxfield's own "Copy for Moxfield" export text (see
# server/src/importers/moxfieldText.ts and PROGRESS.md for why: both a
# server-side and a browser-side fetch of Moxfield's API turned out to be
# dead ends on a real deployment). Since there's no network fetch involved
# anywhere in this path, this script can exercise the FULL success path
# locally and offline, using the real baked-in "eowyn-ayo-win" preset deck
# (server/presets/decks/) as all 4 players.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$REPO_ROOT/engine/.runtime-classpath.txt" ]; then
    echo "Building Forge first (engine/build.sh)..."
    bash "$REPO_ROOT/engine/build.sh"
fi

echo "== Starting the API server =="
API_PORT=4098
API_LOG="$(mktemp -t mtg-sim-dashboard-api-XXXXXX.log)"
# See scripts/phase4-smoke-test.sh for why stdout/stderr must be redirected
# to a file rather than inherited when this script might run under a pipe.
(cd "$REPO_ROOT/server" && PORT=$API_PORT npx tsx src/api/server.ts) >"$API_LOG" 2>&1 &
API_PID=$!
cleanup() {
    kill "$API_PID" 2>/dev/null || true
    local port_pids
    port_pids="$(lsof -ti ":$API_PORT" 2>/dev/null || true)"
    if [ -n "$port_pids" ]; then
        kill $port_pids 2>/dev/null || true
    fi
    for id in "${BAD_RUN_ID:-}" "${GOOD_RUN_ID:-}" "${AUTOSAVE_RUN_ID:-}"; do
        [ -n "$id" ] && rm -f "$REPO_ROOT/data/runs/$id.json"
    done
    [ -n "${AUTOSAVED_DECK_ID:-}" ] && rm -f "$REPO_ROOT/data/decks/$AUTOSAVED_DECK_ID.json"
    rm -f "$API_LOG" /tmp/bad-shape-resp.json /tmp/garbage-body.json /tmp/autosave-body.json
}
trap cleanup EXIT
sleep 1

echo "-- GET /api/decks -> the baked-in preset deck should be listed --"
DECKS=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/decks")
echo "$DECKS" | grep -q "\"eowyn-ayo-win\"" || { echo "FAIL: baked-in preset deck not in /api/decks" >&2; echo "$DECKS" >&2; exit 1; }
echo "$DECKS" | grep -q "\"commanderPreview\":\"Éowyn, Shieldmaiden\"" || { echo "FAIL: no commander preview on the preset deck" >&2; exit 1; }
echo "baked-in preset deck is listed with a commander preview, ok"

echo "-- POST /api/runs with a malformed body (only 3 decks) -> expect 400 --"
BAD_SHAPE_STATUS=$(curl -sS --max-time 10 -o /tmp/bad-shape-resp.json -w "%{http_code}" \
    -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    -d '{"decks":[{"deckId":"eowyn-ayo-win"},{"deckId":"eowyn-ayo-win"},{"deckId":"eowyn-ayo-win"}]}')
[ "$BAD_SHAPE_STATUS" = "400" ] || { echo "FAIL: expected 400, got $BAD_SHAPE_STATUS" >&2; cat /tmp/bad-shape-resp.json >&2; exit 1; }
grep -q "error" /tmp/bad-shape-resp.json || { echo "FAIL: no error field in 400 response" >&2; exit 1; }
echo "validation rejects a decks array of the wrong length, ok"

echo "-- POST /api/runs picking the baked-in preset deck (by id) as all 4 players (full success path) --"
START_RESP=$(curl -sS --max-time 10 -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    -d '{"decks":[{"deckId":"eowyn-ayo-win"},{"deckId":"eowyn-ayo-win"},{"deckId":"eowyn-ayo-win"},{"deckId":"eowyn-ayo-win"}],"games":1,"clockSeconds":60}')
echo "$START_RESP" | grep -q "\"runId\"" || { echo "FAIL: no runId in start response: $START_RESP" >&2; exit 1; }
GOOD_RUN_ID=$(node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).runId' <<<"$START_RESP")
echo "started run $GOOD_RUN_ID"

echo "-- GET /api/runs immediately -> run should already be listed as running --"
LIST=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/runs")
echo "$LIST" | grep -q "\"$GOOD_RUN_ID\"" || { echo "FAIL: run not in list right after starting" >&2; exit 1; }
echo "$LIST" | grep -q "\"running\"" || { echo "FAIL: run not marked running in list" >&2; exit 1; }
echo "run appears immediately with status running, ok"

echo "-- Poll GET /api/runs/\$GOOD_RUN_ID until it leaves 'running' (expect 'complete': a real 1-game Forge batch) --"
STATUS="running"
for _ in $(seq 1 120); do
    SUMMARY=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/runs/$GOOD_RUN_ID")
    if ! echo "$SUMMARY" | grep -q "\"status\":\"running\""; then
        STATUS="done"
        break
    fi
    sleep 1
done
[ "$STATUS" = "done" ] || { echo "FAIL: run never left 'running' status" >&2; exit 1; }
echo "$SUMMARY" | grep -q "\"status\":\"complete\"" || { echo "FAIL: expected status complete, got: $SUMMARY" >&2; exit 1; }
echo "$SUMMARY" | grep -q "\"gameIndex\"" || { echo "FAIL: completed run has no game data" >&2; exit 1; }
echo "real 1-game batch (4x the baked-in preset deck, picked by id) completed successfully end to end, ok"

echo "-- POST /api/runs pasting one fresh deck alongside 3 preset picks -> the fresh one should auto-save --"
node -e '
const fs = require("fs");
const decklistText = fs.readFileSync(process.argv[1], "utf-8");
const decks = [
  { label: "Autosave Test Deck", decklistText },
  { deckId: "eowyn-ayo-win" },
  { deckId: "eowyn-ayo-win" },
  { deckId: "eowyn-ayo-win" },
];
process.stdout.write(JSON.stringify({ decks, games: 1, clockSeconds: 60 }));
' "$REPO_ROOT/server/fixtures/moxfield-eowyn-deck.txt" >/tmp/autosave-body.json
AUTOSAVE_RESP=$(curl -sS --max-time 10 -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    --data @/tmp/autosave-body.json)
AUTOSAVE_RUN_ID=$(node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).runId' <<<"$AUTOSAVE_RESP")
# Give startPodFromDecklistText a moment to resolve/save before checking (it
# saves synchronously up front, but this is a fire-and-forget POST).
sleep 2
DECKS_AFTER=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/decks")
echo "$DECKS_AFTER" | grep -q "Autosave Test Deck" || { echo "FAIL: freshly pasted deck was not auto-saved" >&2; echo "$DECKS_AFTER" >&2; exit 1; }
AUTOSAVED_DECK_ID=$(node -pe '
const decks = JSON.parse(require("fs").readFileSync(0,"utf-8"));
const found = decks.find(d => d.label === "Autosave Test Deck");
found ? found.id : "";
' <<<"$DECKS_AFTER")
[ -n "$AUTOSAVED_DECK_ID" ] || { echo "FAIL: could not find id of auto-saved deck" >&2; exit 1; }
echo "pasted deck was auto-saved to the library (id: $AUTOSAVED_DECK_ID), ok"

echo "-- POST /api/runs where every deck's text is garbage -> expect a real 'failed' status --"
node -e '
const decks = [1,2,3,4].map((n) => ({ label: `garbage${n}`, decklistText: "not a decklist" }));
process.stdout.write(JSON.stringify({ decks, games: 1 }));
' >/tmp/garbage-body.json
FAIL_RESP=$(curl -sS --max-time 10 -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    --data @/tmp/garbage-body.json)
BAD_RUN_ID=$(node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).runId' <<<"$FAIL_RESP")
STATUS="running"
for _ in $(seq 1 30); do
    SUMMARY=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/runs/$BAD_RUN_ID")
    if ! echo "$SUMMARY" | grep -q "\"status\":\"running\""; then
        STATUS="done"
        break
    fi
    sleep 1
done
[ "$STATUS" = "done" ] || { echo "FAIL: garbage-deck run never left 'running' status" >&2; exit 1; }
echo "$SUMMARY" | grep -q "\"status\":\"failed\"" || { echo "FAIL: expected status failed for garbage decklists, got: $SUMMARY" >&2; exit 1; }
echo "$SUMMARY" | grep -q "4/4 decks failed" || { echo "FAIL: expected all 4 decks reported failed, got: $SUMMARY" >&2; exit 1; }
echo "all 4 garbage decklists correctly reported as failed (not just whichever lost a race), ok"

echo "-- ...and none of those garbage decklists should have been saved to the library --"
DECKS_AFTER_GARBAGE=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/decks")
echo "$DECKS_AFTER_GARBAGE" | grep -q "garbage1" && { echo "FAIL: a garbage decklist got saved to the library" >&2; exit 1; }
echo "garbage decklists were correctly NOT saved to the library, ok"

echo "-- POST /api/runs with an unknown deckId -> expect a real 'failed' status --"
node -e '
const decks = [{deckId:"no-such-deck"},{deckId:"eowyn-ayo-win"},{deckId:"eowyn-ayo-win"},{deckId:"eowyn-ayo-win"}];
process.stdout.write(JSON.stringify({ decks, games: 1 }));
' >/tmp/unknown-deck-body.json
UNKNOWN_RESP=$(curl -sS --max-time 10 -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    --data @/tmp/unknown-deck-body.json)
UNKNOWN_RUN_ID=$(node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).runId' <<<"$UNKNOWN_RESP")
STATUS="running"
for _ in $(seq 1 30); do
    SUMMARY=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/runs/$UNKNOWN_RUN_ID")
    if ! echo "$SUMMARY" | grep -q "\"status\":\"running\""; then
        STATUS="done"
        break
    fi
    sleep 1
done
rm -f "$REPO_ROOT/data/runs/$UNKNOWN_RUN_ID.json" /tmp/unknown-deck-body.json
[ "$STATUS" = "done" ] || { echo "FAIL: unknown-deckId run never left 'running' status" >&2; exit 1; }
echo "$SUMMARY" | grep -q "\"status\":\"failed\"" || { echo "FAIL: expected status failed for an unknown deckId, got: $SUMMARY" >&2; exit 1; }
echo "$SUMMARY" | grep -q "no saved deck with id" || { echo "FAIL: expected a clear 'no saved deck' error, got: $SUMMARY" >&2; exit 1; }
echo "an unknown deckId is reported as a clear failure, ok"

cleanup
trap - EXIT

echo
echo "PASS: /api/decks lists the deck library, POST /api/runs runs a real full"
echo "      batch end to end from library picks, auto-saves freshly pasted"
echo "      decks for reuse, and reports clear failures for bad input."
