import { parseMoxfieldTextExport } from "../importers/moxfieldText.js";
import { getDeck } from "../decks/deckLibrary.js";
import { lookupCardTypes } from "../cardTypes/lookupCardTypes.js";
import type { CardCastCount } from "./gameStats.js";
import type { DeckSelection } from "../decks/types.js";

/**
 * Natural extension of "Cards cast" (see computeCardCastCounts): for each
 * player, every nonland card in their actual decklist that never got cast
 * across the run - dead combo pieces, cards stuck in hand the AI never
 * found a use for. Needs two things "Cards cast" alone doesn't: the full
 * decklist (re-resolved from the saved deck library via deckSelections,
 * not the run's own ephemeral staged .dck files - see the doc comment
 * below) and a name -> card type lookup to exclude lands (see
 * lookupCardTypes.ts), since a bare list of "never cast" cards would
 * otherwise be flooded with every land in the deck.
 *
 * Returns an empty map (not an error) for any player this can't be
 * computed for - an older run with no deckSelections, a deck that's since
 * been removed from the library, or a Forge card-type lookup failure (e.g.
 * engine/build.sh hasn't been run in this environment) - so this is always
 * safe to call and just quietly contributes nothing rather than breaking
 * the rest of the stats endpoint.
 */
export async function computeNeverCastCards(
  playerNames: string[],
  deckSelections: DeckSelection[] | undefined,
  commandersByPlayer: Record<string, string[]>,
  cardCastCounts: Record<string, CardCastCount[]>,
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  if (!deckSelections) return result;

  // Re-resolve each player's full decklist from the saved library rather
  // than the run's own staged .dck path (RunSummary.deckPaths): those live
  // under the OS temp dir (see startPodFromDecklistText.ts) and aren't
  // guaranteed to still exist by the time someone's looking at an old run's
  // stats - the saved library entry (deckSelections[i].deckId) is the
  // durable copy.
  const decklists = new Map<string, string[]>(); // player -> mainboard card names (commander excluded)
  for (let i = 0; i < playerNames.length; i++) {
    const selection = deckSelections[i];
    const player = playerNames[i];
    // RunSummary.deckSelections is always normalized to { deckId } by the
    // time it's persisted (see startPodFromDecklistText.ts) - the wider
    // DeckSelection union only matters for the incoming API request shape.
    if (!selection || !("deckId" in selection)) continue;
    const saved = getDeck(selection.deckId);
    if (!saved) continue;
    try {
      const deck = parseMoxfieldTextExport(saved.decklistText, saved.label);
      decklists.set(player, deck.mainboard.map((c) => c.name));
    } catch {
      // Deck text that parsed fine when the run started but doesn't now
      // (shouldn't happen - the library only stores decks that parsed) -
      // skip this player rather than fail the whole computation.
    }
  }
  if (decklists.size === 0) return result;

  const allNames = [...new Set([...decklists.values()].flat())];
  let cardTypes: Record<string, "land" | "nonland" | "?">;
  try {
    cardTypes = await lookupCardTypes(allNames);
  } catch {
    // Forge's card database isn't reachable (e.g. engine/build.sh hasn't
    // been run in this environment) - "never cast" just isn't available
    // this session rather than breaking the rest of /stats.
    return result;
  }

  for (const [player, mainboard] of decklists) {
    const cast = new Set((cardCastCounts[player] ?? []).map((c) => c.card));
    const commanders = new Set(commandersByPlayer[player] ?? []);
    result[player] = mainboard
      .filter((name) => !commanders.has(name))
      .filter((name) => cardTypes[name] !== "land")
      .filter((name) => !cast.has(name))
      // A card can appear more than once in a decklist diff (rare, but a
      // deck could legally run e.g. multiple Relentless Rats) - report it
      // once regardless.
      .filter((name, i, arr) => arr.indexOf(name) === i)
      .sort((a, b) => a.localeCompare(b));
  }

  return result;
}
