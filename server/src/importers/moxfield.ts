import type { CardRef, NormalizedDeck } from "../types/deck.js";

// Moxfield has no official public API docs; this targets the JSON endpoint
// its own web client calls under the hood. IMPORTANT: this session could not
// reach moxfield.com at all (outbound network policy blocks it - see
// PROGRESS.md), so the exact response shape below is unverified against a
// live deck. It's built from the widely-documented community understanding
// of that endpoint. `normalizeMoxfieldDeck` is written defensively (accepts
// a couple of known field-name variants) and is unit-tested against a
// hand-built fixture (fixtures/moxfield-commander-sample.json) so the
// normalization logic itself is validated even without live access - but
// re-running scripts/phase1-smoke-test.sh against a real deck URL, from an
// environment that can reach moxfield.com, is the real validation this still
// needs.

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
