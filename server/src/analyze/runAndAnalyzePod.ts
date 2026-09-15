import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runForgeBatch } from "../simulate/forgeRunner.js";
import { wasCancelled } from "../simulate/activeRuns.js";
import { buildPlayerRoster } from "../convert/readDck.js";
import { parseGameLog } from "../parse/parseGameLog.js";
import { detectTurningPoints } from "../parse/turningPoints.js";
import type { DeckSelection } from "../decks/types.js";
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
  /** The resolved { deckId } for each player, in seat order - persisted so "restart with same decks" doesn't need the original paste text again. */
  deckSelections?: DeckSelection[];
  /** Per-player AI profile/simulation-mode overrides - see BatchRunOptions in simulate/types.ts. Omitted entirely for the common case (every seat on Forge's own defaults). */
  aiProfiles?: string[];
  simModes?: string[];
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

  const runningSummary: RunSummary = {
    runId: opts.runId,
    createdAt,
    status: "running",
    deckUrls: opts.deckUrls,
    deckSelections: opts.deckSelections,
    deckPaths: opts.deckPaths,
    playerNames,
    commandersByPlayer,
    requestedGames: opts.games,
    clockSeconds: opts.clockSeconds,
    aiProfiles: opts.aiProfiles,
    completedGames: 0,
    winsByPlayer: {},
    games: [],
  };
  writeRunSummary(runningSummary);

  try {
    const batch = await runForgeBatch(opts.deckPaths, {
      runId: opts.runId,
      games: opts.games,
      format: "Commander",
      clockSeconds: opts.clockSeconds,
      aiProfiles: opts.aiProfiles,
      simModes: opts.simModes,
      // Real progress instead of a static "0/N" until the whole batch
      // finishes - see forgeRunner.ts's incremental stdout scan. Only
      // completedGames changes here; the full per-game analysis (games
      // array) still only happens once, below, after the batch closes.
      onGameComplete: (completedGames) => {
        writeRunSummary({ ...runningSummary, completedGames });
      },
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
        analyticsEvents: game.analyticsEvents ?? [],
      };
    });

    const summary: RunSummary = {
      runId: opts.runId,
      createdAt,
      status: "complete",
      deckUrls: opts.deckUrls,
      deckSelections: opts.deckSelections,
      deckPaths: opts.deckPaths,
      playerNames,
      commandersByPlayer,
      requestedGames: opts.games,
      clockSeconds: opts.clockSeconds,
      aiProfiles: opts.aiProfiles,
      completedGames: batch.completedGames,
      winsByPlayer,
      games,
    };

    writeRunSummary(summary);
    return summary;
  } catch (err) {
    const cancelled = wasCancelled(opts.runId);
    writeRunSummary({
      runId: opts.runId,
      createdAt,
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Cancelled by user" : err instanceof Error ? err.message : String(err),
      deckUrls: opts.deckUrls,
      deckSelections: opts.deckSelections,
      deckPaths: opts.deckPaths,
      playerNames,
      commandersByPlayer,
      requestedGames: opts.games,
      clockSeconds: opts.clockSeconds,
      aiProfiles: opts.aiProfiles,
      completedGames: 0,
      winsByPlayer: {},
      games: [],
    });
    throw err;
  }
}
