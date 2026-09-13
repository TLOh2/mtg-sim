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
    1 180)

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
LIST=$(curl -sS "http://localhost:4099/api/runs")
echo "$LIST" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const runs=JSON.parse(d);if(!runs.some(r=>r.runId===process.argv[1])){console.error("run not found in list");process.exit(1)}console.log("run present in list, ok")})' "$RUN_ID"

echo "-- GET /api/runs/$RUN_ID --"
SUMMARY=$(curl -sS "http://localhost:4099/api/runs/$RUN_ID")
echo "$SUMMARY" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const r=JSON.parse(d);if(!r.games || r.games.length<1){console.error("no games in summary");process.exit(1)}console.log("run summary ok, "+r.games.length+" game(s)")})'

echo "-- GET /api/runs/$RUN_ID/games/1 --"
GAME=$(curl -sS "http://localhost:4099/api/runs/$RUN_ID/games/1")
echo "$GAME" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const g=JSON.parse(d);if(!g.events || g.events.length<1){console.error("no events in game detail");process.exit(1)}console.log("game detail ok, "+g.events.length+" event(s), "+g.turningPoints.length+" turning point(s)")})'

kill "$API_PID" 2>/dev/null || true

echo
echo "== Building the web dashboard =="
(cd "$REPO_ROOT/web" && npm run build)

echo
echo "PASS: API serves a real persisted run end to end, and the dashboard builds."
