#!/usr/bin/env bash
# Phase 2 self-check: proves the pipeline can run a real 4-deck Commander pod
# through Forge's sim mode and get back structured per-game results (not the
# full spec.json default of 20 games - that's exercised once and recorded in
# PROGRESS.md; 2 games here keeps this fast enough to re-run routinely).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRECON_DIR="$REPO_ROOT/engine/forge/forge-gui/res/adventure/common/decks/starter/commander"

if [ ! -f "$REPO_ROOT/engine/.runtime-classpath.txt" ]; then
    echo "Building Forge first (engine/build.sh)..."
    bash "$REPO_ROOT/engine/build.sh"
fi

cd "$REPO_ROOT/server"
npm test

OUTPUT="$(npm run --silent sim:pod -- phase2-smoke \
    "$PRECON_DIR/red_01.dck" "$PRECON_DIR/blue_01.dck" \
    "$PRECON_DIR/black_01.dck" "$PRECON_DIR/green_01.dck" \
    2 180)"

echo "$OUTPUT"

COMPLETED="$(echo "$OUTPUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).completedGames))')"

if [ "$COMPLETED" -ge 1 ]; then
    echo
    echo "PASS: pod batch run returned $COMPLETED structured game result(s)."
    exit 0
else
    echo
    echo "FAIL: no structured game results came back." >&2
    exit 1
fi
