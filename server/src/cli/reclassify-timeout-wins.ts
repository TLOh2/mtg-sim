#!/usr/bin/env node
// One-off (but kept around in case it's needed again) data-repair script for
// a real bug in Forge's own timeout handling: SimulateMatch.java's
// runWithTimeout cancels the game-simulation thread on a clock timeout, but
// Forge's game loop doesn't check for that cancellation at fine enough
// granularity, so the thread keeps mutating shared game state after the
// timeout fires - racing the main thread's intended "call it a draw"
// outcome and usually winning that race with a stale/partial result (a
// player who didn't actually win the game gets reported as the winner).
// See parseGameResults.ts's doc comment for the full writeup; that file now
// prevents this for new runs by treating any win whose duration reached the
// clock as untrustworthy. This script applies the same correction to
// already-persisted runs (data/runs/*.json), which parseGameResults.ts's
// fix can't retroactively touch.
//
// Usage: tsx src/cli/reclassify-timeout-wins.ts [--dry-run]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { RUNS_DIR, writeRunSummary } from "../analyze/runAndAnalyzePod.js";
import type { RunSummary } from "../analyze/types.js";

function loadRun(file: string): RunSummary {
  return JSON.parse(readFileSync(path.join(RUNS_DIR, file), "utf-8"));
}

function recomputeWinsByPlayer(run: RunSummary): Record<string, number> {
  const winsByPlayer: Record<string, number> = { Draw: 0 };
  for (const name of run.playerNames) winsByPlayer[name] = 0;
  for (const game of run.games) {
    if (game.isDraw) winsByPlayer.Draw += 1;
    else if (game.winnerName) winsByPlayer[game.winnerName] = (winsByPlayer[game.winnerName] ?? 0) + 1;
  }
  return winsByPlayer;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));

  let touchedRuns = 0;
  let touchedGames = 0;

  for (const file of files) {
    const run = loadRun(file);
    if (run.status !== "complete" || !run.clockSeconds) continue;

    const clockMs = run.clockSeconds * 1000;
    let changed = false;
    const games = run.games.map((game) => {
      if (game.isDraw || game.durationMs < clockMs) return game;
      changed = true;
      touchedGames++;
      console.log(
        `${file}: game ${game.gameIndex} reclassified win -> draw ` +
          `(was "${game.winnerName}", durationMs=${game.durationMs} >= clock=${clockMs})`,
      );
      return { ...game, winnerName: null, isDraw: true };
    });

    if (!changed) continue;
    touchedRuns++;

    const corrected: RunSummary = { ...run, games, winsByPlayer: recomputeWinsByPlayer({ ...run, games }) };
    if (!dryRun) writeRunSummary(corrected);
  }

  console.log(
    `\n${dryRun ? "[dry run] would fix" : "Fixed"} ${touchedGames} game(s) across ${touchedRuns} run(s).`,
  );
}

main();
