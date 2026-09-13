import type { CardRef, NormalizedDeck } from "../types/deck.js";

// Parses Moxfield's "Copy for Moxfield" plain-text deck export - the format
// its own deck page's Export panel shows by default, e.g.:
//
//   1 Éowyn, Shieldmaiden (LTC) 86 *F*
//   1 Adarkar Wastes (PDMU) 243p
//   ...
//   SIDEBOARD:
//   1 Aragorn, King of Gondor (LTC) 5
//   ...
//
// Built and validated against a real, complete deck export (see
// fixtures/moxfield-eowyn-deck.txt) - see PROGRESS.md for why this exists at
// all: both a server-side fetch of Moxfield's JSON API (bot detection - a
// real deploy got 403'd) and a browser-side fetch (CORS - Moxfield's API
// sends no Access-Control-Allow-Origin) are dead ends, confirmed against a
// real deployment. This format needs no network request at all - the user
// copies it from Moxfield's own UI and pastes it in.
//
// Format notes from the real export:
// - "<qty> <name> (<SET>) <collector#>[ *F*]" per line. The optional
//   trailing " *F*" marks foil and is stripped (irrelevant to simulation).
//   Collector numbers can have letter suffixes (e.g. "243p") - kept as-is.
// - Modal double-faced cards use " / " (single slash, spaces both sides) -
//   NOT the " // " the Moxfield JSON API uses. Reduced to the front face
//   only here, same reasoning as dck.ts's frontFaceName: Forge's card
//   database indexes these by front face.
// - No explicit "COMMANDER:" header. The commander(s) are simply listed
//   first, before an alphabetically-sorted mainboard - see
//   findMainboardStart below for how that boundary is detected.
// - "SIDEBOARD:" (case-insensitive) marks the start of the sideboard,
//   which NormalizedDeck has no field for and this simply discards -
//   correct, since Commander is a singleton 99+1 format with no sideboard
//   to simulate.

const CARD_LINE = /^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+?)(?:\s+\*F\*)?$/;

interface ParsedLine {
  quantity: number;
  name: string;
  setCode: string;
  collectorNumber: string;
}

function parseLine(line: string): ParsedLine | null {
  const match = line.trim().match(CARD_LINE);
  if (!match) return null;
  const [, qty, rawName, setCode, collectorNumber] = match;
  // MDFCs: "Front Face / Back Face" -> front face only (see module comment).
  const name = rawName.includes(" / ") ? rawName.split(" / ")[0].trim() : rawName.trim();
  return { quantity: Number(qty), name, setCode, collectorNumber };
}

/**
 * Finds where the alphabetically-sorted mainboard begins, walking backward
 * from the end of the list: the mainboard is the longest suffix that is
 * already in ascending order by name, and everything before that boundary
 * is the commander (1 card normally, 2 for partners/background - this
 * generalizes to either without needing to guess a fixed count). Always
 * returns at least 1, since a Commander deck always has at least one
 * commander, even in the rare case a commander's name would already sort
 * correctly on its own (a real but narrow edge case this can't distinguish).
 */
function findMainboardStart(lines: ParsedLine[]): number {
  let i = lines.length - 1;
  while (i > 0 && lines[i - 1].name.localeCompare(lines[i].name) <= 0) {
    i--;
  }
  return Math.max(i, 1);
}

function toCardRef(line: ParsedLine): CardRef {
  return {
    name: line.name,
    setCode: line.setCode,
    collectorNumber: line.collectorNumber,
    quantity: line.quantity,
  };
}

export function parseMoxfieldTextExport(text: string, deckLabel: string): NormalizedDeck {
  const sideboardIndex = text.search(/^\s*sideboard:?\s*$/im);
  const body = sideboardIndex === -1 ? text : text.slice(0, sideboardIndex);

  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(parseLine)
    .filter((l): l is ParsedLine => l !== null);

  if (lines.length === 0) {
    throw new Error(
      `Deck "${deckLabel}": no parseable card lines found - expected Moxfield's "Copy for Moxfield" ` +
        `export format ("<qty> <name> (<SET>) <collector#>" per line).`,
    );
  }

  const mainboardStart = findMainboardStart(lines);
  const commander = lines.slice(0, mainboardStart).map(toCardRef);
  const mainboard = lines.slice(mainboardStart).map(toCardRef);

  return {
    sourceType: "moxfield",
    sourceUrl: deckLabel,
    name: deckLabel,
    commander,
    mainboard,
    fetchedAt: new Date().toISOString(),
  };
}
