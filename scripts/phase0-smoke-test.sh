#!/usr/bin/env bash
# Phase 0 self-check: proves Forge builds headless and its CLI `sim` mode can
# actually play a real Commander game between placeholder decks and return a
# real result. See PRD.md Phase 0 / PROGRESS.md for context.
#
# Uses two of Forge's own bundled Commander precon decks as placeholders
# (guaranteed valid, exercise the real card database) rather than hand-written
# fixtures.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRECON_DIR="$REPO_ROOT/engine/forge/forge-gui/res/adventure/common/decks/starter/commander"
DECK1="$PRECON_DIR/red_01.dck"
DECK2="$PRECON_DIR/blue_01.dck"

if [ ! -f "$REPO_ROOT/engine/.runtime-classpath.txt" ]; then
    echo "Building Forge first (engine/build.sh)..."
    bash "$REPO_ROOT/engine/build.sh"
fi

echo "Running one placeholder Commander game (red precon vs blue precon)..."
OUTPUT="$(bash "$REPO_ROOT/engine/run-sim.sh" phase0-smoke "$DECK1" "$DECK2" -- -f Commander -n 1 -q -c 180)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q "Game Result: .*has won\|Game Result: .*ended in a Draw"; then
    echo
    echo "PASS: Forge sim mode returned a real game result."
    exit 0
else
    echo
    echo "FAIL: no 'Game Result' line found in Forge output." >&2
    exit 1
fi
