import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const ENGINE_DIR = path.join(REPO_ROOT, "engine");
const FORGE_DESKTOP_DIR = path.join(ENGINE_DIR, "forge", "forge-gui-desktop");

/**
 * Everything engine/run-sim.sh used to do, reimplemented in Node so a
 * downloadable package doesn't need bash (or Git for Windows, its usual
 * source on a machine that hasn't set anything else up) just to run a sim -
 * one less runtime to bundle or explain to someone who "just wants to
 * download and run this." Removing the bash hop also means one fewer
 * process in the chain for every run, dev included.
 *
 * Forge's own `-d` flag only accepts deck paths relative to its own
 * deck-storage directory (SimulateMatch.deckFromCommandLineParameter
 * literally string-concatenates baseDir + the given name - an absolute
 * path never works), so deck files still need staging into a run-scoped
 * subdirectory under wherever Forge looks for them.
 */

/** Forge resolves its own per-OS user-data dir (see forge.localinstance.properties.ForgeProfileProperties#getDefaultDirs) - deck staging has to land there or `sim` silently finds nothing. */
function forgeUserDir(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "Forge");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Forge");
  return path.join(os.homedir(), ".forge");
}

/** Copies the given .dck files into a run-scoped folder under Forge's own deck directory and returns their Forge-relative `-d` values. */
function stageDecks(runId: string, deckDckPaths: string[]): string[] {
  const stageDir = path.join(forgeUserDir(), "decks", "commander", runId);
  mkdirSync(stageDir, { recursive: true });
  return deckDckPaths.map((deckPath) => {
    const base = path.basename(deckPath);
    copyFileSync(deckPath, path.join(stageDir, base));
    return `${runId}/${base}`;
  });
}

function runtimeClasspath(): string {
  const cpFile = path.join(ENGINE_DIR, ".runtime-classpath.txt");
  let buildCp: string;
  try {
    buildCp = readFileSync(cpFile, "utf-8").trim();
  } catch {
    throw new Error(`No runtime classpath found at ${cpFile} - run engine/build.sh first.`);
  }
  const classesDirs = ["forge-gui-desktop", "forge-gui", "forge-ai", "forge-game", "forge-core"].map((m) =>
    path.join(ENGINE_DIR, "forge", m, "target", "classes"),
  );
  return [...classesDirs, buildCp].join(path.delimiter);
}

export interface JavaSimInvocation {
  /** Path to the java executable - "java" resolves via PATH; a packaged build points this at a bundled JRE instead. */
  javaExecutable: string;
  args: string[];
  cwd: string;
}

/**
 * Builds everything needed to spawn Forge's headless `sim` mode directly
 * (no shell involved) - deck files staged, classpath resolved, JVM args
 * assembled. `extraSimArgs` is the same flag list forgeRunner.ts already
 * builds (-f/-n/-c/-a/-sim/...), passed straight through after `-d`.
 */
export function buildJavaSimInvocation(runId: string, deckDckPaths: string[], extraSimArgs: string[]): JavaSimInvocation {
  const relativeDecks = stageDecks(runId, deckDckPaths);
  const heapMb = process.env.FORGE_MAX_HEAP_MB ?? "384"; // see engine/run-sim.sh's own comment on why this default is intentionally conservative
  return {
    javaExecutable: process.env.JAVA_EXECUTABLE ?? "java",
    args: [
      "-Djava.awt.headless=true",
      `-Xmx${heapMb}m`,
      "-cp",
      runtimeClasspath(),
      "forge.view.Main",
      "sim",
      "-d",
      ...relativeDecks,
      ...extraSimArgs,
    ],
    cwd: FORGE_DESKTOP_DIR,
  };
}
