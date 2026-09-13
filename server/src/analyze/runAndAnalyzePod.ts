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

export function writeRunSummary(summary: RunSummary): void {
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(path.join(RUNS_DIR, `${summary.runId}.json`), JSON.stringify(summary, null, 2), "utf-8");
}

export interface RunAndAnalyzeOptions {
  runId: string;
  deckPaths: string[];
  games: number;
  clockSeconds: number;
  /** Present when this run was started from Moxfield URLs via the dashboard. */
  deckUrls?: string[];
}

/**
 * The full pipeline, end to end: simulate (Phase 2) -> parse -> analyze
 * (Phase 3), persisted to disk (data/runs/<runId>.json) so the dashboard
 * (Phase 4) can read it without re-running anything.
 *
 * Writes a "running" placeholder immediately (a full batch can take a long
 * time) and overwrites it with "complete" or "failed" once done, so the
 * dashboard has something to poll against throughout.
 */
export async function runAndAnalyzePod(opts: RunAndAnalyzeOptions): Promise<RunSummary> {
  const { playerNames, commandersByPlayer } = buildPlayerRoster(opts.deckPaths);
  const createdAt = new Date().toISOString();

  writeRunSummary({
    runId: opts.runId,
    createdAt,
    status: "running",
    deckUrls: opts.deckUrls,
    deckPaths: opts.deckPaths,
    playerNames,
    requestedGames: opts.games,
    completedGames: 0,
    winsByPlayer: {},
    games: [],
  });

  try {
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
      createdAt,
      status: "complete",
      deckUrls: opts.deckUrls,
      deckPaths: opts.deckPaths,
      playerNames,
      requestedGames: opts.games,
      completedGames: batch.completedGames,
      winsByPlayer,
      games,
    };

    writeRunSummary(summary);
    return summary;
  } catch (err) {
    writeRunSummary({
      runId: opts.runId,
      createdAt,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      deckUrls: opts.deckUrls,
      deckPaths: opts.deckPaths,
      playerNames,
      requestedGames: opts.games,
      completedGames: 0,
      winsByPlayer: {},
      games: [],
    });
    throw err;
  }
}
