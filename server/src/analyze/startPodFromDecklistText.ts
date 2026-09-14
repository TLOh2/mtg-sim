import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseMoxfieldTextExport } from "../importers/moxfieldText.js";
import { toDck } from "../convert/dck.js";
import { getDeck, saveDeck } from "../decks/deckLibrary.js";
import type { DeckSelection } from "../decks/types.js";
import { runAndAnalyzePod, writeRunSummary } from "./runAndAnalyzePod.js";

export interface StartPodFromDecklistsOptions {
  runId: string;
  decks: DeckSelection[];
  games: number;
  clockSeconds: number;
}

/** Best-effort label for display, computable even for a selection that later fails to resolve/parse. */
function describeSelection(selection: DeckSelection, playerIndex: number): string {
  if ("deckId" in selection) return selection.deckId;
  return selection.label.trim() || `Player ${playerIndex + 1}`;
}

/**
 * Resolves one player's selection to a staged .dck file. A `{ deckId }`
 * selection is looked up in the saved library (see decks/deckLibrary.ts).
 * A `{ label, decklistText }` selection is pasted text - deliberately only
 * saved to the library *after* it parses successfully, so a typo or
 * garbage paste doesn't pollute the shared library with junk nobody would
 * ever want to reuse.
 */
async function resolveAndStage(
  selection: DeckSelection,
  playerIndex: number,
  stagingDir: string,
): Promise<{ label: string; dckPath: string }> {
  let label: string;
  let decklistText: string;
  let isFreshPaste: boolean;

  if ("deckId" in selection) {
    const saved = getDeck(selection.deckId);
    if (!saved) {
      throw new Error(`no saved deck with id "${selection.deckId}"`);
    }
    label = saved.label;
    decklistText = saved.decklistText;
    isFreshPaste = false;
  } else {
    label = selection.label.trim() || `Player ${playerIndex + 1}`;
    decklistText = selection.decklistText;
    isFreshPaste = true;
  }

  const deck = parseMoxfieldTextExport(decklistText, label);

  if (isFreshPaste) {
    saveDeck(label, decklistText);
  }

  const dckPath = path.join(stagingDir, `player${playerIndex + 1}.dck`);
  writeFileSync(dckPath, toDck(deck), "utf-8");
  return { label, dckPath };
}

/**
 * Dashboard entry point: 4 decks, each either picked from the saved deck
 * library or pasted fresh (Moxfield's own "Copy for Moxfield" export - see
 * web/src/components/NewRunForm.tsx and ../importers/moxfieldText.ts). No
 * network fetch of Moxfield happens anywhere in this path - by design,
 * since both a server-side fetch (bot detection, confirmed 403 on a real
 * deploy) and a browser-side fetch (CORS, confirmed blocked in a real
 * browser) turned out to be dead ends. See PROGRESS.md for the full story.
 *
 * Meant to be started and not awaited by the caller (the API handler fires
 * this and responds immediately) - all progress and errors are reported
 * through the persisted run file (see runAndAnalyzePod's
 * "running"/"complete"/"failed" status), not this function's return value.
 */
export async function startPodFromDecklistText(opts: StartPodFromDecklistsOptions): Promise<void> {
  const { runId, decks: selections, games, clockSeconds } = opts;
  const createdAt = new Date().toISOString();
  const deckUrls = selections.map(describeSelection);

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
      selections.map((selection, i) => resolveAndStage(selection, i, stagingDir)),
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
      throw new Error(`${failures.length}/${selections.length} decks failed - ${detail}`);
    }

    const resolved = (results as PromiseFulfilledResult<{ label: string; dckPath: string }>[]).map((r) => r.value);
    const deckPaths = resolved.map((d) => d.dckPath);

    await runAndAnalyzePod({ runId, deckPaths, games, clockSeconds, deckUrls: resolved.map((d) => d.label) });
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
