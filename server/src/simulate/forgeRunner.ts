import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseGameResults } from "./parseGameResults.js";
import { registerActiveRun } from "./activeRuns.js";
import type { AnalyticsEvent } from "../parse/types.js";
import type { BatchRunOptions, BatchRunResult } from "./types.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const RUN_SIM_SH = path.join(REPO_ROOT, "engine", "run-sim.sh");

/**
 * Reads back the NDJSON one game's run wrote to FORGE_ANALYTICS_DIR (see
 * AnalyticsEventLogger.java). Best-effort: an older Forge build without the
 * listener, or a game that crashed before producing output, just yields no
 * events rather than failing the whole batch.
 */
function readAnalyticsEvents(analyticsDir: string, gameIndex: number): AnalyticsEvent[] {
  try {
    const raw = readFileSync(path.join(analyticsDir, `game-${gameIndex}.ndjson`), "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as AnalyticsEvent);
  } catch {
    return [];
  }
}

/**
 * Runs a batch of Forge Commander games for a pod of decks (spec.json
 * defaults: 4 decks, 20 games) and returns structured per-game results.
 *
 * Delegates the actual Forge invocation to engine/run-sim.sh (see that
 * script + engine/NOTES.md for why: Forge's `-d` flag only accepts deck
 * paths relative to its own deck-storage directory, which the script
 * handles by staging files into a run-scoped subdirectory). This function's
 * job is orchestration (spawn, capture stdout, surface a clear error if
 * Forge exits non-zero) and turning that raw stdout into GameResult[] via
 * parseGameResults - full event/turning-point parsing is Phase 3.
 */
export function runForgeBatch(deckDckPaths: string[], opts: BatchRunOptions): Promise<BatchRunResult> {
  return new Promise((resolve, reject) => {
    const args = [
      RUN_SIM_SH,
      opts.runId,
      ...deckDckPaths,
      "--",
      "-f",
      opts.format,
      "-n",
      String(opts.games),
      "-c",
      String(opts.clockSeconds),
    ];

    const analyticsDir = mkdtempSync(path.join(os.tmpdir(), `mtg-sim-analytics-${opts.runId}-`));
    const child = spawn("bash", args, {
      cwd: REPO_ROOT,
      env: { ...process.env, FORGE_ANALYTICS_DIR: analyticsDir },
    });
    registerActiveRun(opts.runId, child);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Forge sim run '${opts.runId}' exited with code ${code}:\n${stderr}`));
        return;
      }
      const games = parseGameResults(stdout).map((game) => ({
        ...game,
        analyticsEvents: readAnalyticsEvents(analyticsDir, game.gameIndex),
      }));
      resolve({
        runId: opts.runId,
        deckPaths: deckDckPaths,
        requestedGames: opts.games,
        completedGames: games.length,
        games,
        rawStdout: stdout,
      });
    });
  });
}
