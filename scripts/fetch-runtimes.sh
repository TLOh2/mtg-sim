#!/usr/bin/env bash
# Downloads the portable Node.js and Java runtimes bundled into the
# downloadable Windows package (see build-windows-package.sh) - a friend
# running the packaged app needs neither installed themselves. Run once;
# the extracted runtimes are cached under vendor/runtimes/ (gitignored,
# not source) and reused by every packaging run after that.
#
# Sources are each project's own official distribution - Node.js's own
# CDN, and Eclipse Temurin (the standard OpenJDK build used for exactly
# this kind of bundling, GPLv2+CE licensed, freely redistributable).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$REPO_ROOT/vendor/runtimes"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Pinned to match what this project has actually been built and tested
# against - see engine/forge's own Java 17 requirement and the Node
# version this repo's dev environment runs. Bump deliberately, not
# incidentally, if either ever needs to change.
NODE_VERSION="v24.19.0"
JAVA_MAJOR="17"

mkdir -p "$VENDOR_DIR"

if [ ! -d "$VENDOR_DIR/node-win-x64" ]; then
    echo "Downloading portable Node.js $NODE_VERSION (win-x64)..."
    curl -sL -o "$TMP_DIR/node.zip" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
    unzip -q "$TMP_DIR/node.zip" -d "$TMP_DIR"
    mv "$TMP_DIR/node-$NODE_VERSION-win-x64" "$VENDOR_DIR/node-win-x64"
    echo "  -> $VENDOR_DIR/node-win-x64"
else
    echo "Portable Node.js already cached at $VENDOR_DIR/node-win-x64"
fi

if [ ! -d "$VENDOR_DIR/jre-win-x64" ]; then
    echo "Downloading portable Eclipse Temurin JRE $JAVA_MAJOR (win-x64)..."
    curl -sL -o "$TMP_DIR/jre.zip" "https://api.adoptium.net/v3/binary/latest/$JAVA_MAJOR/ga/windows/x64/jre/hotspot/normal/eclipse"
    unzip -q "$TMP_DIR/jre.zip" -d "$TMP_DIR"
    # The zip's top-level folder name embeds the exact patch version (e.g.
    # jdk-17.0.20.1+1-jre) - find it rather than hardcode it, since "latest"
    # moves.
    JRE_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'jdk-*-jre')"
    mv "$JRE_DIR" "$VENDOR_DIR/jre-win-x64"
    echo "  -> $VENDOR_DIR/jre-win-x64"
else
    echo "Portable JRE already cached at $VENDOR_DIR/jre-win-x64"
fi

echo "Runtimes ready."
