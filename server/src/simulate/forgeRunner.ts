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

// SimulateMatch.java prints this the instant each individual game finishes
// (win or draw), well before the batch itself exits - see
// simulateSingleMatch's `System.out.printf("\nGame Result: Game %d ended...`
// calls. Matching against the growing stdout buffer as chunks arrive (not
// waiting for the process to close) is what makes real incremental progress
// possible instead of everything showing up at once when the whole batch
// finishes - see runAndAnalyzePod.ts's onGameComplete usage.
const GAME_RESULT_LINE = /^Game Result: Game \d+ ended/gm;

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
    let reportedGames = 0;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!opts.onGameComplete) return;
      // Re-scanning the whole buffer each chunk (rather than tracking a
      // read offset) is simplest and cheap enough at this scale (a
      // handful of short lines per game, not the full game log - `-q`
      // quiet mode isn't used here, but this pattern is a tiny fraction
      // of stdout either way).
      const count = (stdout.match(GAME_RESULT_LINE) ?? []).length;
      if (count > reportedGames) {
        reportedGames = count;
        opts.onGameComplete(count);
      }
    });
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
