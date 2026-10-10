import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseGameResults } from "./parseGameResults.js";
import { killProcess, registerActiveRun } from "./activeRuns.js";
import { buildJavaSimInvocation, forgeHeapMb, type JavaSimInvocation } from "./javaSim.js";
import type { AnalyticsEvent } from "../parse/types.js";
import type { BatchRunOptions, BatchRunResult, GameResult } from "./types.js";

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

// Rough per-JVM memory beyond its heap (metaspace, threads, card database).
const JVM_OVERHEAD_MB = 256;

/**
 * How many Forge processes to run side by side. Forge plays one game at a
 * time on roughly one core, so a single process leaves most of a modern CPU
 * idle; this aims for one per physical core, minus one so the machine stays
 * responsive, capped by free memory (each process gets its own heap) and by
 * the game count. FORGE_PARALLEL_BATCHES overrides it - 1 restores the old
 * single-process behaviour.
 */
export function parallelBatchCount(games: number): number {
  const override = Number(process.env.FORGE_PARALLEL_BATCHES);
  if (Number.isInteger(override) && override > 0) return Math.min(override, games);
  const physicalCores = Math.max(1, Math.floor(os.cpus().length / 2));
  const byCpu = Math.max(1, physicalCores - 1);
  const freeMb = os.freemem() / (1024 * 1024);
  const byMemory = Math.max(1, Math.floor((freeMb * 0.85) / (forgeHeapMb() + JVM_OVERHEAD_MB)));
  return Math.max(1, Math.min(games, byCpu, byMemory));
}

/**
 * The per-game time limit to give Forge when `batches` processes share the
 * machine. The limit is wall-clock time, and a game runs slower alongside
 * others - left as-is, more games would hit it and be called draws purely
 * because of how the run was scheduled. Measured on a 6-core Ryzen 5 9600X
 * with the same seeded game: 82s alone, 117-135s with 2-5 running at once
 * (1.45-1.6x). The jump is almost entirely from 1 to 2 - a lone JVM spreads
 * work across otherwise-idle cores - so one flat factor fits every batch count.
 */
export const PARALLEL_SLOWDOWN = 1.5;

export function effectiveClockSeconds(clockSeconds: number, batches: number): number {
  return batches > 1 ? Math.round(clockSeconds * PARALLEL_SLOWDOWN) : clockSeconds;
}

/** Splits `games` into `batches` near-equal chunks, larger ones first. */
export function splitGames(games: number, batches: number): number[] {
  const base = Math.floor(games / batches);
  const extra = games % batches;
  return Array.from({ length: batches }, (_, i) => base + (i < extra ? 1 : 0)).filter((n) => n > 0);
}

interface BatchOutput {
  stdout: string;
  games: GameResult[];
}

function runOneBatch(
  invocation: JavaSimInvocation,
  games: number,
  firstGameIndex: number,
  clockSeconds: number,
  opts: BatchRunOptions,
  children: ChildProcess[],
  onProgress: (completedInThisBatch: number) => void,
): Promise<BatchOutput> {
  return new Promise((resolve, reject) => {
    const analyticsDir = mkdtempSync(path.join(os.tmpdir(), `mtg-sim-analytics-${opts.runId}-`));
    const child = spawn(invocation.javaExecutable, [...invocation.args, "-n", String(games), "-c", String(clockSeconds)], {
      cwd: invocation.cwd,
      env: { ...process.env, FORGE_ANALYTICS_DIR: analyticsDir },
    });
    children.push(child);
    registerActiveRun(opts.runId, child);

    let stdout = "";
    let stderr = "";
    let reported = 0;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // Re-scanning the whole buffer each chunk (rather than tracking a read
      // offset) is simplest and cheap enough at this scale.
      const count = (stdout.match(GAME_RESULT_LINE) ?? []).length;
      if (count > reported) {
        reported = count;
        onProgress(count);
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Forge sim run '${opts.runId}' exited with code ${code}:\n${stderr}`));
        return;
      }
      // Each process numbers its own games from 1 - shifted here so the run
      // reads as one continuous 1..N sequence, log text included.
      const batchGames = parseGameResults(stdout, clockSeconds).map((game) => {
        const gameIndex = firstGameIndex + game.gameIndex - 1;
        return {
          ...game,
          gameIndex,
          rawLog: game.rawLog.replace(/^Game Result: Game \d+ /m, `Game Result: Game ${gameIndex} `),
          analyticsEvents: readAnalyticsEvents(analyticsDir, game.gameIndex),
        };
      });
      resolve({ stdout, games: batchGames });
    });
  });
}

/**
 * Runs a batch of Forge Commander games for a pod of decks (spec.json
 * defaults: 4 decks, 20 games) and returns structured per-game results.
 *
 * Invokes Forge's headless `sim` mode directly (see javaSim.ts) - no shell
 * involved, so this doesn't need bash on the machine it runs on. The games
 * are split across several Forge processes running in parallel (see
 * parallelBatchCount); if any one fails, the rest are stopped so a broken
 * run fails fast instead of finishing the healthy batches first.
 */
export async function runForgeBatch(deckDckPaths: string[], opts: BatchRunOptions): Promise<BatchRunResult> {
  const extraSimArgs = ["-f", opts.format];
  // Both flags are positional (one value per deck, same order) - see
  // SimulateMatch.java's argument parsing. Only appended when actually
  // requested, so a run with neither behaves exactly as before (every
  // seat on Forge's own "Default" profile, simulation off).
  if (opts.aiProfiles?.length) {
    extraSimArgs.push("-a", ...opts.aiProfiles);
  }
  if (opts.simModes?.length) {
    extraSimArgs.push("-sim", ...opts.simModes);
  }

  // Built once: it stages the deck files, and every batch reads the same ones.
  const invocation = buildJavaSimInvocation(opts.runId, deckDckPaths, extraSimArgs);
  const chunks = splitGames(opts.games, parallelBatchCount(opts.games));
  const clockSeconds = effectiveClockSeconds(opts.clockSeconds, chunks.length);

  const children: ChildProcess[] = [];
  const progress = chunks.map(() => 0);
  let reportedTotal = 0;
  let firstGameIndex = 1;

  const batches = chunks.map((games, i) => {
    const start = firstGameIndex;
    firstGameIndex += games;
    return runOneBatch(invocation, games, start, clockSeconds, opts, children, (count) => {
      progress[i] = count;
      const total = progress.reduce((a, b) => a + b, 0);
      if (total > reportedTotal) {
        reportedTotal = total;
        opts.onGameComplete?.(total);
      }
    });
  });

  let outputs: BatchOutput[];
  try {
    outputs = await Promise.all(batches);
  } catch (err) {
    for (const child of children) killProcess(child);
    await Promise.allSettled(batches);
    throw err;
  }

  const games = outputs.flatMap((o) => o.games).sort((a, b) => a.gameIndex - b.gameIndex);
  return {
    runId: opts.runId,
    deckPaths: deckDckPaths,
    requestedGames: opts.games,
    completedGames: games.length,
    games,
    rawStdout: outputs.map((o) => o.stdout).join("\n"),
    parallelBatches: chunks.length,
    effectiveClockSeconds: clockSeconds,
  };
}
