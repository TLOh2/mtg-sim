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
