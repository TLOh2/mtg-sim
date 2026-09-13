#!/usr/bin/env bash
# Self-check for the dashboard's "start a run from 4 Moxfield URLs" feature
# (POST /api/runs). This session's own network egress blocks moxfield.com
# (see PROGRESS.md), so it can't prove a real Moxfield fetch succeeds - but
# it does prove the full plumbing around that: request validation, the
# "running" placeholder appearing immediately, status transitions being
# visible through both the list and detail endpoints, and a real import
# failure (which any user will eventually hit - bad URL, private deck,
# Moxfield being down) surfacing as a readable error rather than a silent
# hang or a crashed server.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
    if [ -n "${RUN_ID:-}" ]; then
        rm -f "$REPO_ROOT/data/runs/$RUN_ID.json"
    fi
    rm -f "$API_LOG"
}
trap cleanup EXIT
sleep 1

echo "-- POST /api/runs with a malformed deck URL -> expect 400 --"
BAD_STATUS=$(curl -sS --max-time 10 -o /tmp/bad-run-resp.json -w "%{http_code}" \
    -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    -d '{"deckUrls":["https://moxfield.com/decks/a","https://moxfield.com/decks/b","https://moxfield.com/decks/c","https://not-moxfield.example/decks/d"]}')
[ "$BAD_STATUS" = "400" ] || { echo "FAIL: expected 400, got $BAD_STATUS" >&2; cat /tmp/bad-run-resp.json >&2; exit 1; }
grep -q "error" /tmp/bad-run-resp.json || { echo "FAIL: no error field in 400 response" >&2; exit 1; }
echo "validation rejects a non-Moxfield URL, ok"

echo "-- POST /api/runs with 4 well-formed (but unreachable, since this session can't hit moxfield.com) deck URLs --"
START_RESP=$(curl -sS --max-time 10 -X POST "http://localhost:$API_PORT/api/runs" \
    -H "Content-Type: application/json" \
    -d '{"deckUrls":["https://moxfield.com/decks/smoketest1","https://moxfield.com/decks/smoketest2","https://moxfield.com/decks/smoketest3","https://moxfield.com/decks/smoketest4"],"games":1}')
echo "$START_RESP" | grep -q "\"runId\"" || { echo "FAIL: no runId in start response: $START_RESP" >&2; exit 1; }
RUN_ID=$(echo "$START_RESP" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).runId' <<<"$START_RESP")
echo "started run $RUN_ID"

echo "-- GET /api/runs immediately -> run should already be listed as running --"
LIST=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/runs")
echo "$LIST" | grep -q "\"$RUN_ID\"" || { echo "FAIL: run not in list right after starting" >&2; exit 1; }
echo "$LIST" | grep -q "\"running\"" || { echo "FAIL: run not marked running in list" >&2; exit 1; }
echo "run appears immediately with status running, ok"

echo "-- Poll GET /api/runs/\$RUN_ID until it leaves 'running' (expect 'failed': no live Moxfield access here) --"
STATUS="running"
for _ in $(seq 1 30); do
    SUMMARY=$(curl -sS --max-time 10 "http://localhost:$API_PORT/api/runs/$RUN_ID")
    if ! echo "$SUMMARY" | grep -q "\"status\":\"running\""; then
        STATUS="done"
        break
    fi
    sleep 1
done
[ "$STATUS" = "done" ] || { echo "FAIL: run never left 'running' status" >&2; exit 1; }
echo "$SUMMARY" | grep -q "\"status\":\"failed\"" || { echo "FAIL: expected status failed (no live Moxfield access), got: $SUMMARY" >&2; exit 1; }
echo "$SUMMARY" | grep -q "\"error\"" || { echo "FAIL: failed run has no error message" >&2; exit 1; }
echo "run transitioned to failed with a real error message once the (blocked) Moxfield fetch failed, ok"
echo "error was: $(echo "$SUMMARY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf-8")).error' <<<"$SUMMARY")"

cleanup
trap - EXIT

echo
echo "PASS: POST /api/runs validates input, persists a 'running' run immediately,"
echo "      and surfaces a real import failure as a readable 'failed' status -"
echo "      not a hang or a crash. (Confirming a full success end-to-end still"
echo "      needs an environment that can actually reach moxfield.com.)"
