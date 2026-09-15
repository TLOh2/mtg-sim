#!/usr/bin/env bash
# Builds only the Forge modules needed to run headless CLI `sim` mode:
# forge-core, forge-game, forge-ai, forge-gui, forge-gui-desktop.
# Skips forge-gui-mobile/-android/-ios, adventure-editor, forge-installer,
# forge-lda: none of those are needed for headless simulation and they
# substantially slow the build (see spec.json engine.modules_intentionally_skipped).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/forge"

MODULES="forge-core,forge-game,forge-ai,forge-gui,forge-gui-desktop"

# The root/parent POM must be installed once so downstream `mvn dependency:*`
# invocations against the local repo can resolve it (see PROGRESS.md /
# engine/NOTES.md: the flatten-maven-plugin that normally rewrites the
# ${revision} placeholder in installed POMs is bound to the `deploy` phase in
# this project, not `install`, so a plain `-pl <modules> install` alone doesn't
# leave a resolvable parent POM behind).
mvn -q -N install -Dcheckstyle.skip=true

# Build + install the modules we need. -am pulls in their reactor dependencies
# in the same session, so classpath resolution afterwards doesn't hit the
# ${revision} POM problem either.
mvn -q -pl "$MODULES" -am install -DskipTests -Dcheckstyle.skip=true -Dmaven.javadoc.skip=true

# Emit a runtime classpath file other scripts (run-sim.sh) can source.
mvn -q -pl forge-gui-desktop -am dependency:build-classpath \
    -Dmdep.outputFile="$SCRIPT_DIR/.runtime-classpath.txt" \
    -DincludeScope=runtime -Dcheckstyle.skip=true

# Also copy the actual runtime-scope jars into a portable folder (not just
# a classpath *file* pointing at wherever this machine's local Maven repo
# happens to live - ~/.m2, which a downloadable package obviously can't
# assume). server/src/simulate/javaSim.ts builds its classpath from
# whatever jars are actually sitting in here, so this step is what makes
# that portable rather than just reading .runtime-classpath.txt's
# machine-specific absolute paths.
mvn -q -pl forge-gui-desktop -am dependency:copy-dependencies \
    -DincludeScope=runtime -Dcheckstyle.skip=true \
    -DoutputDirectory="$SCRIPT_DIR/runtime-libs"

echo "Forge build complete. Runtime classpath written to engine/.runtime-classpath.txt; jars copied to engine/runtime-libs/"
