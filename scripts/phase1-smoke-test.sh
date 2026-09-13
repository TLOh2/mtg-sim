#!/usr/bin/env bash
# Phase 1 self-check: proves the normalize -> .dck conversion pipeline
# produces output Forge can actually load and play, not just something that
# "looks right". See PROGRESS.md for why this uses a fixture rather than a
# live Moxfield fetch (moxfield.com is unreachable from this sandbox's
# network egress policy - a real blocker, documented there).
#
# What this actually validates: the server package's unit tests (fixture ->
# NormalizedDeck -> .dck string shape) PLUS a real Forge load/play using that
# generated .dck file - i.e. Forge's card-name resolution and .dck parser
# both accept our output, which is the part most likely to break silently.
#
# What this does NOT validate: that Moxfield's real API actually returns the
# shape server/src/importers/moxfield.ts expects. That needs a live fetch
# from a network that can reach moxfield.com - re-run
# `npm run import:moxfield -- <a real deck URL>` there to close that gap.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATED_DCK="$(mktemp -t mtg-sim-phase1-XXXXXX.dck)"
trap 'rm -f "$GENERATED_DCK"' EXIT

echo "== Running server unit tests (importer + converter, against fixture) =="
(cd "$REPO_ROOT/server" && npm test)

echo
echo "== Generating a .dck from the fixture deck =="
(cd "$REPO_ROOT/server" && npx tsx src/cli/generate-fixture-dck.ts "$GENERATED_DCK")
cat "$GENERATED_DCK"

if [ ! -f "$REPO_ROOT/engine/.runtime-classpath.txt" ]; then
    echo "Building Forge first (engine/build.sh)..."
    bash "$REPO_ROOT/engine/build.sh"
fi

echo
echo "== Feeding the generated .dck into a real Forge game (vs a Forge precon) =="
PRECON="$REPO_ROOT/engine/forge/forge-gui/res/adventure/common/decks/starter/commander/red_01.dck"
OUTPUT="$(bash "$REPO_ROOT/engine/run-sim.sh" phase1-smoke "$GENERATED_DCK" "$PRECON" -- -f Commander -n 1 -q -c 120)"
echo "$OUTPUT"

if echo "$OUTPUT" | grep -qi "could not load deck"; then
    echo
    echo "FAIL: Forge could not load the generated .dck." >&2
    exit 1
fi
if echo "$OUTPUT" | grep -q "Game Result: .*has won\|Game Result: .*ended in a Draw"; then
    echo
    echo "PASS: the converter's .dck output loaded and played a real game in Forge."
    exit 0
else
    echo
    echo "FAIL: no 'Game Result' line found in Forge output." >&2
    exit 1
fi
