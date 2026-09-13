#!/usr/bin/env bash
# Self-check for the dashboard's "start a run from 4 Moxfield decks" feature
# (POST /api/runs). The dashboard fetches each deck's JSON in the browser
# (not the server - see web/src/moxfieldClient.ts / PROGRESS.md for why:
# server-side fetches to Moxfield's API got 403'd on a real deployment) and
# posts { url, raw } pairs. That means this script can exercise the FULL
# success path locally and offline, using the real fixture deck as the
# "already-fetched" raw payload for all 4 players - something the old
# URL-fetching version of this feature could never prove in this session.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$REPO_ROOT/server/fixtures/moxfield-commander-sample.json"

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
    rm -f "$API_LOG" "$BAD_URL_BODY" "$GOOD_BODY"
}
trap cleanup EXIT
sleep 1

echo "-- POST /api/runs with a malformed body (missing 'raw') -> expect 400 --"
BAD_SHAPE_STATUS=$(curl -sS --max-time 10 -o /tmp/bad-shape-resp.json -w "%{http_code}" \
    -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    -d '{"decks":[{"url":"https://moxfield.com/decks/a"}]}')
[ "$BAD_SHAPE_STATUS" = "400" ] || { echo "FAIL: expected 400, got $BAD_SHAPE_STATUS" >&2; cat /tmp/bad-shape-resp.json >&2; exit 1; }
echo "validation rejects a malformed decks array, ok"

echo "-- POST /api/runs with 4 decks but one non-Moxfield URL -> expect 400 --"
BAD_URL_BODY="$(mktemp -t mtg-sim-bad-url-body-XXXXXX.json)"
node -e '
const raw = { boards: {} };
const urls = ["https://moxfield.com/decks/a","https://moxfield.com/decks/b","https://moxfield.com/decks/c","https://not-moxfield.example/decks/d"];
process.stdout.write(JSON.stringify({ decks: urls.map((url) => ({ url, raw })) }));
' >"$BAD_URL_BODY"
BAD_STATUS=$(curl -sS --max-time 10 -o /tmp/bad-run-resp.json -w "%{http_code}" \
    -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    --data @"$BAD_URL_BODY")
[ "$BAD_STATUS" = "400" ] || { echo "FAIL: expected 400, got $BAD_STATUS" >&2; cat /tmp/bad-run-resp.json >&2; exit 1; }
grep -q "error" /tmp/bad-run-resp.json || { echo "FAIL: no error field in 400 response" >&2; exit 1; }
echo "validation rejects a non-Moxfield URL, ok"

echo "-- POST /api/runs with a real deck's already-fetched JSON as all 4 players (full success path) --"
GOOD_BODY="$(mktemp -t mtg-sim-good-body-XXXXXX.json)"
node -e '
const fs = require("fs");
const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
const decks = [1, 2, 3, 4].map((n) => ({ url: `https://moxfield.com/decks/fixture-p${n}`, raw }));
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
echo "real 1-game batch (4x the fixture deck) completed successfully end to end, ok"

echo "-- POST /api/runs where every deck's 'raw' is garbage (no commander board) -> expect a real 'failed' status --"
node -e '
const decks = [1,2,3,4].map((n) => ({ url: `https://moxfield.com/decks/garbage${n}`, raw: { boards: {} } }));
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
echo "$SUMMARY" | grep -q "\"status\":\"failed\"" || { echo "FAIL: expected status failed for garbage decks, got: $SUMMARY" >&2; exit 1; }
echo "$SUMMARY" | grep -q "4/4 decks failed to normalize" || { echo "FAIL: expected all 4 decks reported failed, got: $SUMMARY" >&2; exit 1; }
echo "all 4 garbage decks correctly reported as failed (not just whichever lost a race), ok"

cleanup
trap - EXIT

echo
echo "PASS: POST /api/runs validates input, runs a real full batch end to end"
echo "      from already-fetched deck JSON (no network fetch of its own),"
echo "      and reports every failed deck rather than an arbitrary one."
