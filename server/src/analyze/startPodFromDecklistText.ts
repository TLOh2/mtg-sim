import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseMoxfieldTextExport } from "../importers/moxfieldText.js";
import { toDck } from "../convert/dck.js";
import { runAndAnalyzePod, writeRunSummary } from "./runAndAnalyzePod.js";

export interface DeckInput {
  label: string;
  decklistText: string;
}

export interface StartPodFromDecklistsOptions {
  runId: string;
  decks: DeckInput[];
  games: number;
  clockSeconds: number;
}

/**
 * Dashboard entry point: 4 decklists pasted from Moxfield's own "Copy for
 * Moxfield" export (see web/src/components/NewRunForm.tsx and
 * ../importers/moxfieldText.ts). No network fetch of Moxfield happens
 * anywhere in this path - by design, since both a server-side fetch
 * (bot detection, confirmed 403 on a real deploy) and a browser-side fetch
 * (CORS, confirmed blocked in a real browser) turned out to be dead ends.
 * See PROGRESS.md for the full story.
 *
 * Meant to be started and not awaited by the caller (the API handler fires
 * this and responds immediately) - all progress and errors are reported
 * through the persisted run file (see runAndAnalyzePod's
 * "running"/"complete"/"failed" status), not this function's return value.
 */
export async function startPodFromDecklistText(opts: StartPodFromDecklistsOptions): Promise<void> {
  const { runId, decks, games, clockSeconds } = opts;
  const createdAt = new Date().toISOString();
  const deckUrls = decks.map((d) => d.label);

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
      decks.map(async ({ label, decklistText }, i) => {
        const deck = parseMoxfieldTextExport(decklistText, label);
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
      throw new Error(`${failures.length}/${decks.length} decklists failed to parse - ${detail}`);
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
