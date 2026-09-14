import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseMoxfieldTextExport } from "./moxfieldText.js";
import { toDck } from "../convert/dck.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const eowynExport = readFileSync(
  path.join(here, "..", "..", "fixtures", "moxfield-eowyn-deck.txt"),
  "utf-8",
);
const sauronExport = readFileSync(
  path.join(here, "..", "..", "fixtures", "archidekt-sauron-deck.txt"),
  "utf-8",
);
const nobilityExport = readFileSync(
  path.join(here, "..", "..", "fixtures", "tappedout-nobility-are-athirst-deck.csv"),
  "utf-8",
);

test("parseMoxfieldTextExport finds the one commander, positioned first and out of order", () => {
  const deck = parseMoxfieldTextExport(eowynExport, "Ayo, Win");
  assert.equal(deck.commander.length, 1);
  assert.equal(deck.commander[0].name, "Éowyn, Shieldmaiden");
  assert.equal(deck.commander[0].setCode, "LTC");
  assert.equal(deck.commander[0].collectorNumber, "86");
  assert.equal(deck.commander[0].quantity, 1);
});

test("parseMoxfieldTextExport gets the full mainboard, excluding the commander and the sideboard", () => {
  const deck = parseMoxfieldTextExport(eowynExport, "Ayo, Win");
  // 87 non-blank lines before SIDEBOARD:, minus the 1 commander line = 86.
  assert.equal(deck.mainboard.length, 86);
  assert.ok(!deck.mainboard.some((c) => c.name === "Éowyn, Shieldmaiden"));
  // Nothing from the sideboard should leak into mainboard.
  assert.ok(!deck.mainboard.some((c) => c.name === "Aragorn, King of Gondor"));
});

test("parseMoxfieldTextExport strips the foil marker but keeps a promo-style collector number suffix", () => {
  const deck = parseMoxfieldTextExport(eowynExport, "Ayo, Win");
  const island = deck.mainboard.find((c) => c.name === "Island");
  assert.equal(island?.quantity, 3);
  assert.equal(island?.setCode, "LTR");
  assert.equal(island?.collectorNumber, "716");

  const adarkarWastes = deck.mainboard.find((c) => c.name === "Adarkar Wastes");
  assert.equal(adarkarWastes?.collectorNumber, "243p");
});

test("parseMoxfieldTextExport reduces MDFCs to the front face (this export's separator is ' / ', not ' // ')", () => {
  const deck = parseMoxfieldTextExport(eowynExport, "Ayo, Win");
  const pathway = deck.mainboard.find((c) => c.name.startsWith("Needleverge"));
  assert.equal(pathway?.name, "Needleverge Pathway");
  assert.equal(pathway?.setCode, "ZNR");
  assert.equal(pathway?.collectorNumber, "263");
  assert.ok(!deck.mainboard.some((c) => c.name.includes("Pillarverge")));
});

test("parseMoxfieldTextExport output converts to a valid-looking .dck", () => {
  const deck = parseMoxfieldTextExport(eowynExport, "Ayo, Win");
  const dck = toDck(deck);
  assert.match(dck, /\[Commander\]/);
  assert.match(dck, /^1 Éowyn, Shieldmaiden\|LTC\|86$/m);
  assert.match(dck, /^3 Island\|LTR\|716$/m);
  assert.doesNotMatch(dck, /Aragorn, King of Gondor/);
});

test("parseMoxfieldTextExport throws a clear error on unparseable input", () => {
  assert.throws(() => parseMoxfieldTextExport("not a decklist at all", "bad deck"), /no parseable card lines/);
});

// Archidekt's Export -> Text -> Copy, every setting left at its default
// (fixture captured with a cleared localStorage, so this is genuinely what
// a friend who's never touched the Export dialog gets - see moxfieldText.ts's
// module doc comment for how this differs from Moxfield's own shape).

test("parseMoxfieldTextExport detects Archidekt's default export via its [Category] tags and finds the commander via [Commander]", () => {
  const deck = parseMoxfieldTextExport(sauronExport, "Sauron, the Dark Lord");
  assert.equal(deck.sourceType, "archidekt");
  assert.equal(deck.commander.length, 1);
  assert.equal(deck.commander[0].name, "Sauron, the Dark Lord");
  assert.equal(deck.commander[0].setCode, "ltr");
  assert.equal(deck.commander[0].collectorNumber, "329");
});

test("parseMoxfieldTextExport excludes Archidekt's {noDeck} out-of-deck extras (tokens etc.) from the mainboard", () => {
  const deck = parseMoxfieldTextExport(sauronExport, "Sauron, the Dark Lord");
  assert.ok(!deck.mainboard.some((c) => c.name === "Orc Army"));
  assert.ok(!deck.mainboard.some((c) => c.name === "Wraith"));
  // 88 lines total - 1 commander - 2 out-of-deck extras = 85.
  assert.equal(deck.mainboard.length, 85);
});

test("parseMoxfieldTextExport handles Archidekt's 'Nx' quantity and '//' MDFC separator", () => {
  const deck = parseMoxfieldTextExport(sauronExport, "Sauron, the Dark Lord");
  const nazgul = deck.mainboard.find((c) => c.name === "Nazgûl");
  assert.equal(nazgul?.quantity, 9);

  const preciousRing = deck.mainboard.find((c) => c.name.startsWith("My Precious"));
  assert.equal(preciousRing?.name, "My Precious");
  assert.ok(!deck.mainboard.some((c) => c.name.includes("Allure of Power")));
});

// TappedOut's CSV export (Export/Download -> CSV), captured from a real
// public deck ("The Nobility Are Athirst" by Mortlocke) - the only one of
// TappedOut's export formats that actually marks the commander (a literal
// "True" in the trailing Commander column). See moxfieldText.ts's module
// doc comment for why the other two formats (plain Text, Markdown/Reddit)
// were dead ends.

test("parseMoxfieldTextExport detects TappedOut's CSV via its header and finds the commander via the Commander column", () => {
  const deck = parseMoxfieldTextExport(nobilityExport, "The Nobility Are Athirst");
  assert.equal(deck.sourceType, "tappedout");
  assert.equal(deck.commander.length, 1);
  assert.equal(deck.commander[0].name, "Edgar Markov");
  assert.equal(deck.commander[0].setCode, "C17");
  // TappedOut's CSV never gives a collector number, only a set code.
  assert.equal(deck.commander[0].collectorNumber, null);
});

test("parseMoxfieldTextExport gets the full mainboard from TappedOut's CSV, excluding the commander", () => {
  const deck = parseMoxfieldTextExport(nobilityExport, "The Nobility Are Athirst");
  // 85 distinct card lines total (100 cards counting quantity) minus the 1 commander line = 84.
  assert.equal(deck.mainboard.length, 84);
  assert.ok(!deck.mainboard.some((c) => c.name === "Edgar Markov"));
  const totalQuantity = deck.mainboard.reduce((sum, c) => sum + c.quantity, 0) + deck.commander[0].quantity;
  assert.equal(totalQuantity, 100);
});

test("parseMoxfieldTextExport handles TappedOut's CSV-quoted names containing a comma", () => {
  const deck = parseMoxfieldTextExport(nobilityExport, "The Nobility Are Athirst");
  const agadeem = deck.mainboard.find((c) => c.name === "Agadeem, the Undercrypt");
  assert.equal(agadeem?.setCode, "ZNR");
  const sorin = deck.mainboard.find((c) => c.name === "Sorin, Imperious Bloodlord");
  assert.equal(sorin?.setCode, "INR");
});

test("parseMoxfieldTextExport falls back to a null setCode for TappedOut rows with a blank Printing column", () => {
  const deck = parseMoxfieldTextExport(nobilityExport, "The Nobility Are Athirst");
  const sanguineBond = deck.mainboard.find((c) => c.name === "Sanguine Bond");
  assert.equal(sanguineBond?.setCode, null);
});

test("parseMoxfieldTextExport output from TappedOut's CSV converts to a valid-looking .dck (name-only lines, since there's no collector number)", () => {
  const deck = parseMoxfieldTextExport(nobilityExport, "The Nobility Are Athirst");
  const dck = toDck(deck);
  assert.match(dck, /\[Commander\]/);
  assert.match(dck, /^1 Edgar Markov$/m);
  assert.match(dck, /^3 Plains$/m);
  assert.match(dck, /^14 Swamp$/m);
});
