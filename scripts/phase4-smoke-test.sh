#!/usr/bin/env bash
# Phase 4 self-check: proves the API server can serve a real persisted run
# (list/summary/game-detail endpoints) and that the web dashboard builds.
# Runs its own small (1-game) batch rather than depending on some other run
# already existing, so this is self-contained and fast to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRECON_DIR="$REPO_ROOT/engine/forge/forge-gui/res/adventure/common/decks/starter/commander"
RUN_ID="phase4-smoke-$$"

if [ ! -f "$REPO_ROOT/engine/.runtime-classpath.txt" ]; then
    echo "Building Forge first (engine/build.sh)..."
    bash "$REPO_ROOT/engine/build.sh"
fi

echo "== Running a 1-game pod and persisting the analyzed result =="
(cd "$REPO_ROOT/server" && npm run --silent analyze:pod -- "$RUN_ID" \
    "$PRECON_DIR/red_01.dck" "$PRECON_DIR/blue_01.dck" \
    "$PRECON_DIR/black_01.dck" "$PRECON_DIR/green_01.dck" \
    1 60)

RESULT_FILE="$REPO_ROOT/data/runs/$RUN_ID.json"
if [ ! -f "$RESULT_FILE" ]; then
    echo "FAIL: expected $RESULT_FILE to exist" >&2
    exit 1
fi

echo
echo "== Starting the API server =="
API_PORT=4099
API_LOG="$(mktemp -t mtg-sim-phase4-api-XXXXXX.log)"
# IMPORTANT: redirect the background server's stdout/stderr to a file, not
# inherit this script's own - otherwise, if this script is itself piped
# (e.g. `... | tail`), the server keeps that pipe's write end open for as
# long as it lives and blocks the reader forever, even after this script
# exits. (Learned the hard way: an earlier version of this script hung for
# 2+ hours because of exactly that, with an orphaned server process still
# holding the pipe open - see PROGRESS.md.)
(cd "$REPO_ROOT/server" && PORT=$API_PORT npx tsx src/api/server.ts) >"$API_LOG" 2>&1 &
API_PID=$!
cleanup() {
    kill "$API_PID" 2>/dev/null || true
    # Belt-and-suspenders: npx/tsx may fork a node process that outlives the
    # subshell PID captured above (that's exactly what leaked last time), so
    # also reap anything actually bound to the port, whoever's PID it is.
    local port_pids
    port_pids="$(lsof -ti ":$API_PORT" 2>/dev/null || true)"
    if [ -n "$port_pids" ]; then
        kill $port_pids 2>/dev/null || true
    fi
    rm -f "$RESULT_FILE" "$API_LOG"
}
trap cleanup EXIT
sleep 1

echo "-- GET /api/runs --"
LIST=$(curl -sS --max-time 10 "http://localhost:4099/api/runs")
echo "$LIST" | grep -q "\"$RUN_ID\"" || { echo "FAIL: run not found in list" >&2; exit 1; }
echo "run present in list, ok"

echo "-- GET /api/runs/$RUN_ID --"
SUMMARY=$(curl -sS --max-time 10 "http://localhost:4099/api/runs/$RUN_ID")
echo "$SUMMARY" | grep -q "\"gameIndex\"" || { echo "FAIL: no games in summary" >&2; exit 1; }
echo "run summary ok"

echo "-- GET /api/runs/$RUN_ID/games/1 --"
GAME=$(curl -sS --max-time 10 "http://localhost:4099/api/runs/$RUN_ID/games/1")
echo "$GAME" | grep -q "\"events\"" || { echo "FAIL: no events in game detail" >&2; exit 1; }
echo "game detail ok"
cleanup

echo
echo "== Building the web dashboard =="
(cd "$REPO_ROOT/web" && npm run build)

echo
echo "PASS: API serves a real persisted run end to end, and the dashboard builds."
