import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeMoxfieldDeck, type MoxfieldRawDeck } from "../importers/moxfield.js";
import { toDck } from "../convert/dck.js";
import { runAndAnalyzePod, writeRunSummary } from "./runAndAnalyzePod.js";

export interface DeckInput {
  url: string;
  raw: unknown;
}

export interface StartPodFromDecksOptions {
  runId: string;
  decks: DeckInput[];
  games: number;
  clockSeconds: number;
}

/**
 * Dashboard entry point: 4 already-fetched Moxfield deck JSON blobs (fetched
 * by the browser, not this server - see web/src/moxfieldClient.ts for why:
 * a server-side fetch to Moxfield's API gets 403'd, most likely by
 * TLS/network-level bot detection that no amount of header-spoofing clears,
 * confirmed against a real deploy - see PROGRESS.md). Normalizes each,
 * converts to .dck, and hands off to the same simulate/parse/analyze
 * pipeline the CLI and the URL-fetching path both used.
 *
 * Meant to be started and not awaited by the caller (the API handler fires
 * this and responds immediately) - all progress and errors are reported
 * through the persisted run file (see runAndAnalyzePod's
 * "running"/"complete"/"failed" status), not this function's return value.
 */
export async function startPodFromMoxfieldDecks(opts: StartPodFromDecksOptions): Promise<void> {
  const { runId, decks, games, clockSeconds } = opts;
  const createdAt = new Date().toISOString();
  const deckUrls = decks.map((d) => d.url);

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
    const results = await Promise.allSettled(
      decks.map(async ({ url, raw }, i) => {
        const deck = normalizeMoxfieldDeck(raw as MoxfieldRawDeck, url);
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
      throw new Error(`${failures.length}/${decks.length} decks failed to normalize - ${detail}`);
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
