import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runForgeBatch } from "../simulate/forgeRunner.js";
import { buildPlayerRoster } from "../convert/readDck.js";
import { parseGameLog } from "../parse/parseGameLog.js";
import { detectTurningPoints } from "../parse/turningPoints.js";
import type { RunSummary } from "./types.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const RUNS_DIR = path.join(REPO_ROOT, "data", "runs");

export interface RunAndAnalyzeOptions {
  runId: string;
  deckPaths: string[];
  games: number;
  clockSeconds: number;
}

/**
 * The full pipeline, end to end: simulate (Phase 2) -> parse -> analyze
 * (Phase 3), persisted to disk (data/runs/<runId>.json) so the dashboard
 * (Phase 4) can read it without re-running anything.
 */
export async function runAndAnalyzePod(opts: RunAndAnalyzeOptions): Promise<RunSummary> {
  const { playerNames, commandersByPlayer } = buildPlayerRoster(opts.deckPaths);

  const batch = await runForgeBatch(opts.deckPaths, {
    runId: opts.runId,
    games: opts.games,
    format: "Commander",
    clockSeconds: opts.clockSeconds,
  });

  const winsByPlayer: Record<string, number> = { Draw: 0 };
  for (const name of playerNames) winsByPlayer[name] = 0;

  const games = batch.games.map((game) => {
    const events = parseGameLog(game.rawLog, playerNames);
    const turningPoints = detectTurningPoints(events, { commandersByPlayer });

    if (game.isDraw) {
      winsByPlayer.Draw += 1;
    } else if (game.winnerName) {
      winsByPlayer[game.winnerName] = (winsByPlayer[game.winnerName] ?? 0) + 1;
    }

    return {
      gameIndex: game.gameIndex,
      winnerName: game.winnerName,
      isDraw: game.isDraw,
      durationMs: game.durationMs,
      events,
      turningPoints,
      rawLog: game.rawLog,
    };
  });

  const summary: RunSummary = {
    runId: opts.runId,
    createdAt: new Date().toISOString(),
    deckPaths: opts.deckPaths,
    playerNames,
    requestedGames: opts.games,
    completedGames: batch.completedGames,
    winsByPlayer,
    games,
  };

  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(path.join(RUNS_DIR, `${opts.runId}.json`), JSON.stringify(summary, null, 2), "utf-8");

  return summary;
}
