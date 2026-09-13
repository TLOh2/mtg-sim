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
    const deckPaths = await Promise.all(
      deckUrls.map(async (url, i) => {
        let deck;
        try {
          deck = await importMoxfieldDeck(url);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Player ${i + 1} deck (${url}) failed to import: ${message}`);
        }
        const dckPath = path.join(stagingDir, `player${i + 1}.dck`);
        writeFileSync(dckPath, toDck(deck), "utf-8");
        return dckPath;
      }),
    );

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
