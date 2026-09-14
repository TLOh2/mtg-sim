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
# -XX:MaxRAMPercentage lets the JVM claim a real share of whatever memory the
# host/container actually has (modern OpenJDK is cgroup-aware by default),
# rather than its own conservative ~25%-of-detected-memory default - needed
# after a real deploy hit OutOfMemoryError loading Forge's ~34k-card database
# on a small container. If this alone isn't enough, the container genuinely
# doesn't have enough RAM for Forge and needs a bigger instance size - no
# flag fixes that. See PROGRESS.md.
exec java -Djava.awt.headless=true -XX:MaxRAMPercentage=75.0 -cp "$FULL_CP" forge.view.Main sim -d "${RELATIVE_DECKS[@]}" "${EXTRA_ARGS[@]}"
