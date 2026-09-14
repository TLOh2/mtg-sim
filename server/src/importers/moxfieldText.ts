import type { CardRef, DeckSourceType, NormalizedDeck } from "../types/deck.js";

// Parses pasted decklist exports. Originally Moxfield-only (see git
// history); now also accepts Archidekt's "Text" export and TappedOut's
// "CSV" export, each confirmed against a real deck (empirically - not
// guessed, per spec.json#deck_sources.archidekt.do_not_guess, the same
// policy applied to every source added here since). Auto-detected, no
// source picker needed - see the format notes below for each.
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
//
// TappedOut (Export/Download -> CSV):
//
//   Board,Qty,Name,Printing,Foil,Alter,Signed,Condition,Language,Commander
//   main,1,"Agadeem, the Undercrypt",ZNR,,,,,,
//   main,1,Edgar Markov,C17,,,,,,True
//   main,1,"Edgar, Charmed Groom",VOW,,,,,,
//   ...
//
// Confirmed against a real public deck ("The Nobility Are Athirst" by
// Mortlocke) - TappedOut's deck pages sit behind a Cloudflare bot check
// that blocks fetching them directly (browser or server-side), so this was
// gathered by asking the user to export it themselves and paste the
// result, same do_not_guess spirit as the browser-driven research for
// Archidekt. Two other TappedOut export formats were dead ends worth
// recording so they aren't retried: the plain "Text (.txt)" export is just
// "<qty> <name>" per line with the *entire* 100-card deck (commander
// included) in one alphabetically-sorted block and no way to tell the
// commander apart - unlike Moxfield, the commander isn't even pulled out
// of sort order; and "Markdown/Reddit" isn't a decklist at all, just a
// short embed shortcode TappedOut expands client-side when rendered
// elsewhere. CSV is the only export that actually marks the commander (a
// literal "True" in the trailing Commander column), which is why it's the
// one this parses despite the "Text (.txt)" name being the more obvious
// first guess for a plain-paste format - the same lesson as Archidekt's
// research: check what a format can actually tell you apart before
// assuming the plainest-looking option is usable.
//
// Real structural differences from the other two, all handled below:
// - No collector number at all (only a set code, in "Printing" - and
//   sometimes not even that, e.g. a blank Printing for one card in the
//   sample deck). toDck's cardLine already falls back to name-only
//   resolution whenever collectorNumber is missing, which every TappedOut
//   card triggers - functionally fine, since Forge resolves *some* legal
//   printing by name either way and this project doesn't care which
//   printing/art a card comes from for simulation purposes.
// - "Board" column (not sort order or a bracket tag) says where a card
//   goes: "main" for the mainboard, discarded otherwise (TappedOut's
//   maybeboard/acquireboard use different values there) - the Commander
//   column is checked first and wins regardless of Board, since a
//   commander's own Board value in the wild wasn't confirmed to always be
//   "main" and there's no reason to require it.
// - Standard CSV quoting (a name containing a comma, e.g. "Agadeem, the
//   Undercrypt", is wrapped in double quotes) - handled with a small
//   RFC4180-style line splitter rather than a dependency, consistent with
//   this project's preference for hand-rolled parsing over adding a
//   library for something this contained (see AnalyticsEventLogger.java's
//   own hand-rolled JSON writer for the same reasoning elsewhere).

const CARD_LINE =
  /^(\d+)x?\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+?)(?:\s+\*F\*)?(?:\s+\[([^\]]*)\])?$/;

interface ParsedLine {
  quantity: number;
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
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
  `export, Archidekt's Export -> Text -> Copy (defaults are fine for both), or TappedOut's ` +
  `Export/Download -> CSV.`;

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

// TappedOut's CSV export header, confirmed against the real captured
// sample - checked as a plain string prefix (not a fuzzy match) since this
// is the one reliable signal that the pasted text is CSV at all, before
// any line-by-line parsing is attempted.
const CSV_HEADER = "Board,Qty,Name,Printing";

function hasCsvHeader(text: string): boolean {
  return text.trimStart().startsWith(CSV_HEADER);
}

/** Minimal RFC4180-style single-line CSV splitter: double-quoted fields may contain commas, and "" inside a quoted field is an escaped literal quote. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseByCsv(text: string): { commander: ParsedLine[]; mainboard: ParsedLine[] } {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim().length > 0);

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const boardCol = col("Board");
  const qtyCol = col("Qty");
  const nameCol = col("Name");
  const printingCol = col("Printing");
  const commanderCol = col("Commander");

  const commander: ParsedLine[] = [];
  const mainboard: ParsedLine[] = [];

  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const name = fields[nameCol]?.trim();
    const quantity = Number(fields[qtyCol]);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;

    const parsed: ParsedLine = {
      quantity,
      name: stripMdfcBackFace(name),
      setCode: fields[printingCol]?.trim() || null,
      collectorNumber: null, // TappedOut's CSV never includes one - see module doc comment.
      category: null,
    };

    // The Commander column wins regardless of Board - a commander's own
    // Board value wasn't confirmed to always be "main" in the wild, and
    // there's no reason to require it.
    if (fields[commanderCol]?.trim().toLowerCase() === "true") {
      commander.push(parsed);
    } else if (fields[boardCol]?.trim().toLowerCase() === "main") {
      mainboard.push(parsed);
    }
    // Any other Board value (TappedOut's maybeboard/acquireboard) is discarded.
  }

  return { commander, mainboard };
}

function detectSourceType(hasCategoryTagsResult: boolean): DeckSourceType {
  return hasCategoryTagsResult ? "archidekt" : "moxfield";
}

export function parseMoxfieldTextExport(text: string, deckLabel: string): NormalizedDeck {
  let commander: ParsedLine[];
  let mainboard: ParsedLine[];
  let sourceType: DeckSourceType;

  if (hasCsvHeader(text)) {
    sourceType = "tappedout";
    ({ commander, mainboard } = parseByCsv(text));
  } else {
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
    sourceType = detectSourceType(isArchidekt);

    if (isArchidekt) {
      ({ commander, mainboard } = parseByCategoryTags(lines));
    } else {
      const mainboardStart = findMainboardStart(lines);
      commander = lines.slice(0, mainboardStart);
      mainboard = lines.slice(mainboardStart);
    }
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
