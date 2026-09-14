#!/usr/bin/env bash
# Thin wrapper around Forge's headless CLI `sim` mode.
#
# Forge's sim mode (forge.view.Main -> forge.view.SimulateMatch) only accepts
# deck references relative to its own deck-storage directory
# ($HOME/.forge/decks/commander/ for Commander) - passing an absolute path to
# `-d` does not work (SimulateMatch.deckFromCommandLineParameter literally
# string-concatenates baseDir + the given name; see PROGRESS.md Phase 0
# findings). So this wrapper stages the given .dck files into a run-scoped
# subdirectory under Forge's deck dir and passes relative paths through.
#
# Usage:
#   engine/run-sim.sh <run-id> <deck1.dck> <deck2.dck> [<deck3.dck> <deck4.dck> ...] -- [extra `sim` args]
#
# Example:
#   engine/run-sim.sh smoke-test deck1.dck deck2.dck -- -f Commander -n 1 -c 180
#
# Prints Forge's raw stdout (game log + result lines) to stdout.
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CP_FILE="$ENGINE_DIR/.runtime-classpath.txt"

if [ ! -f "$CP_FILE" ]; then
    echo "No runtime classpath found - run engine/build.sh first." >&2
    exit 1
fi

RUN_ID="$1"; shift

DECKS=()
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    DECKS+=("$1")
    shift
done
if [ "${1:-}" = "--" ]; then shift; fi
EXTRA_ARGS=("$@")

FORGE_DECK_DIR="${HOME}/.forge/decks/commander/${RUN_ID}"
mkdir -p "$FORGE_DECK_DIR"

RELATIVE_DECKS=()
for deck in "${DECKS[@]}"; do
    base="$(basename "$deck")"
    cp "$deck" "$FORGE_DECK_DIR/$base"
    RELATIVE_DECKS+=("${RUN_ID}/${base}")
done

BUILD_CP="$(cat "$CP_FILE")"
CLASSES_CP="$ENGINE_DIR/forge/forge-gui-desktop/target/classes:$ENGINE_DIR/forge/forge-gui/target/classes:$ENGINE_DIR/forge/forge-ai/target/classes:$ENGINE_DIR/forge/forge-game/target/classes:$ENGINE_DIR/forge/forge-core/target/classes"
FULL_CP="$CLASSES_CP:$BUILD_CP"

cd "$ENGINE_DIR/forge/forge-gui-desktop"
# An earlier version of this used -XX:MaxRAMPercentage=75.0 to let the JVM
# claim a share of container memory - on a real deploy with only 512MB
# total, that let the JVM's memory demands collide with Node's own and take
# down the *whole* container (confirmed via Render's memory graph spiking to
# 100% right as it crashed - a 502, not a clean per-run failure). An
# explicit, conservative heap cap instead means a too-small instance fails
# *this one Forge run* cleanly (a catchable OutOfMemoryError - see
# forgeRunner.ts) rather than crashing the whole service for everyone using
# it. FORGE_MAX_HEAP_MB is overridable via env var so a bigger instance can
# just raise it without another code change. See PROGRESS.md.
FORGE_MAX_HEAP_MB="${FORGE_MAX_HEAP_MB:-384}"
exec java -Djava.awt.headless=true "-Xmx${FORGE_MAX_HEAP_MB}m" -cp "$FULL_CP" forge.view.Main sim -d "${RELATIVE_DECKS[@]}" "${EXTRA_ARGS[@]}"
