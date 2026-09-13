import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { importMoxfieldDeck } from "../importers/moxfield.js";
import { toDck } from "../convert/dck.js";
import { runAndAnalyzePod, writeRunSummary } from "./runAndAnalyzePod.js";

export interface StartPodFromUrlsOptions {
  runId: string;
  deckUrls: string[];
  games: number;
  clockSeconds: number;
}

/**
 * Dashboard entry point: import 4 real Moxfield decks by URL, convert each
 * to .dck, and hand them to the same simulate/parse/analyze pipeline the
 * CLI uses. Meant to be started and not awaited by the caller (the API
 * handler fires this and responds immediately) - all progress and errors
 * are reported through the persisted run file (see runAndAnalyzePod's
 * "running"/"complete"/"failed" status), not this function's return value.
 */
export async function startPodFromMoxfieldUrls(opts: StartPodFromUrlsOptions): Promise<void> {
  const { runId, deckUrls, games, clockSeconds } = opts;
  const createdAt = new Date().toISOString();

  writeRunSummary({
    runId,
    createdAt,
    status: "running",
    deckUrls,
    deckPaths: [],
    playerNames: [],
    requestedGames: games,
    completedGames: 0,
    winsByPlayer: {},
    games: [],
  });

  try {
    const stagingDir = mkdtempSync(path.join(os.tmpdir(), `mtg-sim-${runId}-`));
    // Import all 4 in parallel, but wait for every result (not just the
    // first rejection) - a fast-fail Promise.all here would only ever
    // surface whichever deck happened to fail first in a network race,
    // which looks misleadingly like "a different deck failed this time"
    // when the real, useful signal is how many of the 4 failed and why.
    const results = await Promise.allSettled(
      deckUrls.map(async (url, i) => {
        const deck = await importMoxfieldDeck(url);
        const dckPath = path.join(stagingDir, `player${i + 1}.dck`);
        writeFileSync(dckPath, toDck(deck), "utf-8");
        return dckPath;
      }),
    );

    const failures = results
      .map((r, i) => ({ r, i }))
      .filter((x): x is { r: PromiseRejectedResult; i: number } => x.r.status === "rejected");

    if (failures.length > 0) {
      const detail = failures
        .map(({ r, i }) => {
          const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
          return `Player ${i + 1} (${deckUrls[i]}): ${message}`;
        })
        .join(" | ");
      throw new Error(`${failures.length}/4 deck imports failed - ${detail}`);
    }

    const deckPaths = (results as PromiseFulfilledResult<string>[]).map((r) => r.value);

    await runAndAnalyzePod({ runId, deckPaths, games, clockSeconds, deckUrls });
  } catch (err) {
    writeRunSummary({
      runId,
      createdAt,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      deckUrls,
      deckPaths: [],
      playerNames: [],
      requestedGames: games,
      completedGames: 0,
      winsByPlayer: {},
      games: [],
    });
  }
}
