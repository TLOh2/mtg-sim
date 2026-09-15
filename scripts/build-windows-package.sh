#!/usr/bin/env bash
# Assembles a self-contained, downloadable Windows package: a folder a
# non-technical friend can extract and double-click, with nothing else to
# install - no Node, no Java, no build step, not even Git for Windows
# (used only for bash during development; the packaged app spawns java
# directly, see server/src/simulate/javaSim.ts).
#
# Prerequisites (this machine, once): engine/build.sh has been run, and
# scripts/fetch-runtimes.sh has downloaded the portable Node/JRE into
# vendor/runtimes/. Both are cheap to re-run; this script doesn't redo
# them itself so a repeat package build (after a small code change) stays
# fast - just the two `npm run build` steps and a handful of file copies.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENGINE_DIR="$REPO_ROOT/engine"
VENDOR_DIR="$REPO_ROOT/vendor/runtimes"
OUT_DIR="$REPO_ROOT/dist-package/CommanderSim"

if [ ! -d "$ENGINE_DIR/runtime-libs" ] || [ ! -d "$ENGINE_DIR/forge/forge-gui-desktop/target/classes" ]; then
    echo "Forge hasn't been built yet - run engine/build.sh first." >&2
    exit 1
fi
if [ ! -d "$VENDOR_DIR/node-win-x64" ] || [ ! -d "$VENDOR_DIR/jre-win-x64" ]; then
    echo "Portable runtimes not found - run scripts/fetch-runtimes.sh first." >&2
    exit 1
fi

echo "Building server..."
(cd "$REPO_ROOT/server" && npm run build)

echo "Building dashboard..."
(cd "$REPO_ROOT/web" && npm run build)

echo "Assembling package at $OUT_DIR..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# --- Portable runtimes ---
mkdir -p "$OUT_DIR/runtime"
cp -r "$VENDOR_DIR/node-win-x64" "$OUT_DIR/runtime/node"
cp -r "$VENDOR_DIR/jre-win-x64" "$OUT_DIR/runtime/jre"

# --- Server (compiled JS - zero runtime npm dependencies, see
#     server/package.json, so no node_modules needed at all here) - plus
#     the baked-in preset decks (server/src/decks/deckLibrary.ts's
#     PRESET_DECKS_DIR), so a fresh download has example decks to try
#     without pasting anything in first. ---
mkdir -p "$OUT_DIR/server"
cp -r "$REPO_ROOT/server/dist" "$OUT_DIR/server/dist"
cp -r "$REPO_ROOT/server/presets" "$OUT_DIR/server/presets"

# --- Dashboard (static build the server itself serves - see
#     server/src/api/server.ts's REPO_ROOT/WEB_DIST_DIR: 3 directories up
#     from the compiled server.js, i.e. $OUT_DIR here, + web/dist - NOT a
#     flattened "web-dist", or the server won't find it). ---
mkdir -p "$OUT_DIR/web"
cp -r "$REPO_ROOT/web/dist" "$OUT_DIR/web/dist"

# --- Forge: only the 5 built modules' classes + the one resource
#     directory it actually needs at runtime (forge-gui/res - see
#     GuiDesktop#getAssetsDir's "../forge-gui/" - not forge-gui-desktop,
#     which is where the JVM's cwd is set to) + the portable runtime jars.
#     Deliberately NOT the rest of the forge/ checkout (source, other
#     platforms' modules, target/ build junk beyond target/classes) -
#     this is the one directory shape Forge's own hardcoded relative path
#     resolution requires, nothing more. ---
for module in forge-gui-desktop forge-gui forge-ai forge-game forge-core; do
    mkdir -p "$OUT_DIR/engine/forge/$module/target"
    cp -r "$ENGINE_DIR/forge/$module/target/classes" "$OUT_DIR/engine/forge/$module/target/classes"
done
cp -r "$ENGINE_DIR/forge/forge-gui/res" "$OUT_DIR/engine/forge/forge-gui/res"
cp -r "$ENGINE_DIR/runtime-libs" "$OUT_DIR/engine/runtime-libs"

# --- Launcher ---
cp "$SCRIPT_DIR/CommanderSim-launcher.bat" "$OUT_DIR/Start.bat"

SIZE="$(du -sh "$OUT_DIR" | cut -f1)"
echo
echo "Package assembled at $OUT_DIR ($SIZE)."
echo "Double-click Start.bat inside it to run - no separate install needed."
