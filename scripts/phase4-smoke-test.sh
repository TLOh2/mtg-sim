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
(cd "$REPO_ROOT/server" && PORT=4099 npx tsx src/api/server.ts) &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true; rm -f "$RESULT_FILE"' EXIT
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

kill "$API_PID" 2>/dev/null || true

echo
echo "== Building the web dashboard =="
(cd "$REPO_ROOT/web" && npm run build)

echo
echo "PASS: API serves a real persisted run end to end, and the dashboard builds."
