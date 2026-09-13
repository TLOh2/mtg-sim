import type { CardRef, NormalizedDeck } from "../types/deck.js";

// Moxfield has no official public API docs; this targets the JSON endpoint
// its own web client calls under the hood. This session's own network egress
// is blocked from reaching moxfield.com directly (see PROGRESS.md), but the
// shape below has now been CONFIRMED against a real response: the user
// fetched a live deck (a Jeskai Human Knights Commander deck, commander
// Éowyn, Shieldmaiden) via this exact endpoint and pasted the raw JSON.
// `card.set` and `card.cn` are exactly right - no fallback field names are
// actually needed - and `boards.{commanders,mainboard,sideboard}.cards` is a
// Record<string, entry> as modeled here. The `set_code`/`collector_number`
// fallbacks in toCardRef are kept as harmless defensive coding but are dead
// code against the real API. One real-data wrinkle this did surface: MDFCs
// (modal double-faced cards) come back with a combined "Front // Back" name
// (e.g. "Needleverge Pathway // Pillarverge Pathway") - handled in
// ../convert/dck.ts by truncating to the front face, since that's how
// Forge's card database indexes them. `fixtures/moxfield-commander-sample.json`
// reflects this confirmed real shape, including an MDFC entry.

const API_BASE = "https://api2.moxfield.com/v3/decks/all";

export function extractMoxfieldPublicId(deckUrl: string): string {
  // e.g. https://www.moxfield.com/decks/AbCd1234EfGh -> AbCd1234EfGh
  const match = deckUrl.match(/moxfield\.com\/decks\/([^/?#]+)/i);
  if (!match) {
    throw new Error(`Not a recognizable Moxfield deck URL: ${deckUrl}`);
  }
  return match[1];
}

export interface MoxfieldRawCard {
  name: string;
  set?: string;
  set_code?: string;
  cn?: string;
  collector_number?: string;
}

export interface MoxfieldRawBoardEntry {
  quantity: number;
  card: MoxfieldRawCard;
}

export interface MoxfieldRawBoard {
  count?: number;
  cards: Record<string, MoxfieldRawBoardEntry>;
}

export interface MoxfieldRawDeck {
  id: string;
  name: string;
  format?: string;
  boards: {
    mainboard?: MoxfieldRawBoard;
    commanders?: MoxfieldRawBoard;
    sideboard?: MoxfieldRawBoard;
  };
}

export async function fetchMoxfieldDeck(deckUrl: string): Promise<MoxfieldRawDeck> {
  const publicId = extractMoxfieldPublicId(deckUrl);
  const res = await fetch(`${API_BASE}/${publicId}`, {
    headers: {
      // Moxfield has historically rejected requests with no UA / a bare
      // Node default UA; a normal-browser-looking UA is the documented
      // workaround in the community tooling this is modeled on.
      "User-Agent":
        "Mozilla/5.0 (compatible; mtg-sim/0.1; +https://github.com/TLOh2/mtg-sim)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Moxfield API request failed: ${res.status} ${res.statusText} for deck ${publicId}`,
    );
  }
  return (await res.json()) as MoxfieldRawDeck;
}

function toCardRef(entry: MoxfieldRawBoardEntry): CardRef {
  const card = entry.card;
  return {
    name: card.name,
    setCode: card.set ?? card.set_code ?? null,
    collectorNumber: card.cn ?? card.collector_number ?? null,
    quantity: entry.quantity,
  };
}

function boardToCardRefs(board: MoxfieldRawBoard | undefined): CardRef[] {
  if (!board?.cards) return [];
  return Object.values(board.cards).map(toCardRef);
}

export function normalizeMoxfieldDeck(raw: MoxfieldRawDeck, sourceUrl: string): NormalizedDeck {
  const commander = boardToCardRefs(raw.boards.commanders);
  const mainboard = boardToCardRefs(raw.boards.mainboard);

  if (commander.length === 0) {
    throw new Error(
      `Deck "${raw.name}" (${raw.id}) has no commander in its 'commanders' board - ` +
        "is this actually a Commander-format deck on Moxfield?",
    );
  }

  return {
    sourceType: "moxfield",
    sourceUrl,
    name: raw.name,
    commander,
    mainboard,
    fetchedAt: new Date().toISOString(),
  };
}

export async function importMoxfieldDeck(deckUrl: string): Promise<NormalizedDeck> {
  const raw = await fetchMoxfieldDeck(deckUrl);
  return normalizeMoxfieldDeck(raw, deckUrl);
}
