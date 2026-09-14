import type { CardRef, DeckSourceType, NormalizedDeck } from "../types/deck.js";

// Parses pasted plain-text decklist exports. Originally Moxfield-only (see
// git history); now also accepts Archidekt's "Text" export, confirmed
// against a real deck (empirically, via the browser - not guessed, per
// spec.json#deck_sources.archidekt.do_not_guess). Deliberately targets each
// site's *default* export settings - no checkboxes to change - so the
// instruction to a friend is the same shape for either site: open the
// deck's Export/Copy action and paste what you get. See the two format
// notes below; auto-detected, no source picker needed.
//
// Moxfield ("Copy for Moxfield", the default export on its deck page):
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
// real deploy got 403'd, and confirmed still 403s even from a home
// connection, not just Render's datacenter IPs) and a browser-side fetch
// (CORS - Moxfield's API sends no Access-Control-Allow-Origin) are dead
// ends. This format needs no network request at all - the user copies it
// from Moxfield's own UI and pastes it in.
//
// Format notes from the real export:
// - "<qty> <name> (<SET>) <collector#>[ *F*]" per line. The optional
//   trailing " *F*" marks foil and is stripped (irrelevant to simulation).
//   Collector numbers can have letter suffixes (e.g. "243p") - kept as-is.
// - Modal double-faced cards use " / " (single slash, spaces both sides).
// - No explicit "COMMANDER:" header. The commander(s) are simply listed
//   first, before an alphabetically-sorted mainboard - see
//   findMainboardStart below for how that boundary is detected.
// - "SIDEBOARD:" (case-insensitive) marks the start of the sideboard,
//   which NormalizedDeck has no field for and this simply discards -
//   correct, since Commander is a singleton 99+1 format with no sideboard
//   to simulate.
//
// Archidekt (Export -> Text -> Copy, every setting left at its default):
//
//   1x An Offer You Can't Refuse (fic) 267 [Removal]
//   1x Arcane Signet (msc) 191 [Ramp]
//   ...
//   1x Sauron, the Dark Lord (ltr) 329 [Commander{top}]
//   ...
//   1x My Precious // Allure of Power (hob) 176 [Artifact]
//   1x Orc Army (tltr) 18 *F* [Tokens & Extras{noDeck}]
//
// Confirmed live against a real deck (Sauron, the Dark Lord by slapper_19)
// with a totally fresh export-settings state (cleared localStorage, which
// is where Archidekt remembers your last-used export options, so this is
// genuinely what a friend who's never touched the Export dialog gets).
// Three real differences from Moxfield's shape, all handled below:
// - Quantity is "1x", not "1".
// - Every card carries a trailing "[Category]" tag - Archidekt's own
//   auto-assigned category, not something the user configures. The
//   commander is unambiguous: its tag is "Commander" (with a "{top}"
//   suffix that's just decoration - discarded). This is what actually
//   distinguishes this format from Moxfield's, and is more reliable than
//   Moxfield's sort-order heuristic besides.
// - "Include out of deck cards" (maybeboard, extra tokens) is on by
//   default, and those lines carry a "{noDeck}" suffix inside the same
//   bracket - dropped the same way Moxfield's SIDEBOARD is.
// - MDFCs come through as "Front // Back" (double slash) since "front
//   name only" isn't the default; split the same way Moxfield's own
//   double-slash form is handled.

const CARD_LINE =
  /^(\d+)x?\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+?)(?:\s+\*F\*)?(?:\s+\[([^\]]*)\])?$/;

interface ParsedLine {
  quantity: number;
  name: string;
  setCode: string;
  collectorNumber: string;
  /** Archidekt's trailing "[Category{modifier}]" tag, if this line had one. */
  category: { name: string; outOfDeck: boolean } | null;
}

function stripMdfcBackFace(rawName: string): string {
  // Archidekt's default ("front name only" unchecked) uses " // "; Moxfield
  // uses " / ". Front face only either way, same reasoning as dck.ts's
  // frontFaceName: Forge's card database indexes these by front face.
  if (rawName.includes(" // ")) return rawName.split(" // ")[0].trim();
  if (rawName.includes(" / ")) return rawName.split(" / ")[0].trim();
  return rawName.trim();
}

/** Splits Archidekt's "Category{modifier}" bracket content into the two parts - the modifier (e.g. "{top}", "{noDeck}") is optional and always trails the name. */
function parseCategoryTag(raw: string): { name: string; outOfDeck: boolean } {
  const match = raw.match(/^(.*?)\{([^}]*)\}$/);
  if (!match) return { name: raw.trim(), outOfDeck: false };
  return { name: match[1].trim(), outOfDeck: match[2] === "noDeck" };
}

function parseLine(line: string): ParsedLine | null {
  const match = line.trim().match(CARD_LINE);
  if (!match) return null;
  const [, qty, rawName, setCode, collectorNumber, rawCategory] = match;
  return {
    quantity: Number(qty),
    name: stripMdfcBackFace(rawName),
    setCode,
    collectorNumber,
    category: rawCategory !== undefined ? parseCategoryTag(rawCategory) : null,
  };
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

const NOT_FOUND_ERROR = (deckLabel: string) =>
  `Deck "${deckLabel}": no parseable card lines found - expected Moxfield's "Copy for Moxfield" ` +
  `export, or Archidekt's Export -> Text -> Copy (defaults are fine for both).`;

/** True if any line carries Archidekt's "[Category]" tag - the one real structural difference from Moxfield's shape (see module doc comment). */
function hasCategoryTags(lines: ParsedLine[]): boolean {
  return lines.some((l) => l.category !== null);
}

function parseByCategoryTags(lines: ParsedLine[]): { commander: ParsedLine[]; mainboard: ParsedLine[] } {
  const commander: ParsedLine[] = [];
  const mainboard: ParsedLine[] = [];
  for (const line of lines) {
    if (line.category?.outOfDeck) continue;
    if (line.category?.name.toLowerCase() === "commander") commander.push(line);
    else mainboard.push(line);
  }
  return { commander, mainboard };
}

function detectSourceType(hasCategoryTagsResult: boolean): DeckSourceType {
  return hasCategoryTagsResult ? "archidekt" : "moxfield";
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
    throw new Error(NOT_FOUND_ERROR(deckLabel));
  }

  const isArchidekt = hasCategoryTags(lines);
  const sourceType = detectSourceType(isArchidekt);

  let commander: ParsedLine[];
  let mainboard: ParsedLine[];

  if (isArchidekt) {
    ({ commander, mainboard } = parseByCategoryTags(lines));
  } else {
    const mainboardStart = findMainboardStart(lines);
    commander = lines.slice(0, mainboardStart);
    mainboard = lines.slice(mainboardStart);
  }

  if (commander.length === 0 || mainboard.length === 0) {
    throw new Error(NOT_FOUND_ERROR(deckLabel));
  }

  return {
    sourceType,
    sourceUrl: deckLabel,
    name: deckLabel,
    commander: commander.map(toCardRef),
    mainboard: mainboard.map(toCardRef),
    fetchedAt: new Date().toISOString(),
  };
}
