#!/usr/bin/env bash
# Self-check for the dashboard's "start a run from 4 pasted decklists"
# feature (POST /api/runs). Decks are pasted decklist text (Moxfield's own
# "Copy for Moxfield" export - see server/src/importers/moxfieldText.ts and
# PROGRESS.md for why: both a server-side fetch and a browser-side fetch of
# Moxfield's API turned out to be dead ends on a real deployment). Since
# there's no network fetch involved at all, this script can exercise the
# FULL success path locally and offline, using a real complete deck export
# (fixtures/moxfield-eowyn-deck.txt - a real ~100-card Commander deck with
# MDFCs, foil markers, and promo-suffix collector numbers) as all 4 players.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$REPO_ROOT/server/fixtures/moxfield-eowyn-deck.txt"

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
    for id in "${BAD_RUN_ID:-}" "${GOOD_RUN_ID:-}"; do
        [ -n "$id" ] && rm -f "$REPO_ROOT/data/runs/$id.json"
    done
    rm -f "$API_LOG" "$GOOD_BODY" /tmp/garbage-body.json /tmp/bad-shape-resp.json
}
trap cleanup EXIT
sleep 1

echo "-- POST /api/runs with a malformed body (only 3 decks) -> expect 400 --"
BAD_SHAPE_STATUS=$(curl -sS --max-time 10 -o /tmp/bad-shape-resp.json -w "%{http_code}" \
    -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    -d '{"decks":[{"label":"a","decklistText":"1 Sol Ring (CMM) 382"},{"label":"b","decklistText":"1 Sol Ring (CMM) 382"},{"label":"c","decklistText":"1 Sol Ring (CMM) 382"}]}')
[ "$BAD_SHAPE_STATUS" = "400" ] || { echo "FAIL: expected 400, got $BAD_SHAPE_STATUS" >&2; cat /tmp/bad-shape-resp.json >&2; exit 1; }
grep -q "error" /tmp/bad-shape-resp.json || { echo "FAIL: no error field in 400 response" >&2; exit 1; }
echo "validation rejects a decks array of the wrong length, ok"

echo "-- POST /api/runs with a real deck's pasted export as all 4 players (full success path) --"
GOOD_BODY="$(mktemp -t mtg-sim-good-body-XXXXXX.json)"
node -e '
const fs = require("fs");
const decklistText = fs.readFileSync(process.argv[1], "utf-8");
const decks = [1, 2, 3, 4].map((n) => ({ label: `Fixture Deck P${n}`, decklistText }));
process.stdout.write(JSON.stringify({ decks, games: 1, clockSeconds: 60 }));
' "$FIXTURE" >"$GOOD_BODY"

START_RESP=$(curl -sS --max-time 10 -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    --data @"$GOOD_BODY")
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
echo "real 1-game batch (4x the real ~100-card Eowyn deck) completed successfully end to end, ok"

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
echo "$SUMMARY" | grep -q "4/4 decklists failed to parse" || { echo "FAIL: expected all 4 decks reported failed, got: $SUMMARY" >&2; exit 1; }
echo "all 4 garbage decklists correctly reported as failed (not just whichever lost a race), ok"

cleanup
trap - EXIT

echo
echo "PASS: POST /api/runs validates input, runs a real full batch end to end"
echo "      from pasted decklist text (no network fetch of its own), and"
echo "      reports every failed deck rather than an arbitrary one."
