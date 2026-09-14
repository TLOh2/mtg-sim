#!/usr/bin/env bash
# Thin wrapper around Forge's headless CLI `cardtypes` mode (forge.view.Main
# -> forge.view.CardTypeLookup) - same classpath assembly as run-sim.sh,
# without the deck-staging steps that mode doesn't need.
#
# Reads card names from stdin (one per line), writes "name\tland|nonland|?"
# to stdout in the same order - see CardTypeLookup.java. Used by
# server/src/cardTypes/lookupCardTypes.ts to power the "never cast" feature
# (excluding lands from a decklist diff needs Forge's own card database,
# since lands don't reliably contain the word "land" in their name).
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CP_FILE="$ENGINE_DIR/.runtime-classpath.txt"

if [ ! -f "$CP_FILE" ]; then
    echo "No runtime classpath found - run engine/build.sh first." >&2
    exit 1
fi

BUILD_CP="$(cat "$CP_FILE")"
CLASSES_CP="$ENGINE_DIR/forge/forge-gui-desktop/target/classes:$ENGINE_DIR/forge/forge-gui/target/classes:$ENGINE_DIR/forge/forge-ai/target/classes:$ENGINE_DIR/forge/forge-game/target/classes:$ENGINE_DIR/forge/forge-core/target/classes"
FULL_CP="$CLASSES_CP:$BUILD_CP"

cd "$ENGINE_DIR/forge/forge-gui-desktop"
# Same conservative heap cap as run-sim.sh, and for the same reason - see
# that script's comment. FModel.initialize loads the whole card database
# either way, so this mode's memory footprint is comparable to a sim run.
FORGE_MAX_HEAP_MB="${FORGE_MAX_HEAP_MB:-384}"
exec java -Djava.awt.headless=true "-Xmx${FORGE_MAX_HEAP_MB}m" -cp "$FULL_CP" forge.view.Main cardtypes
