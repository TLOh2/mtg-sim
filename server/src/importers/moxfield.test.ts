import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { normalizeMoxfieldDeck, extractMoxfieldPublicId, type MoxfieldRawDeck } from "./moxfield.js";
import { toDck } from "../convert/dck.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture: MoxfieldRawDeck = JSON.parse(
  readFileSync(path.join(here, "..", "..", "fixtures", "moxfield-commander-sample.json"), "utf-8"),
);

test("extractMoxfieldPublicId pulls the id out of a deck URL", () => {
  assert.equal(
    extractMoxfieldPublicId("https://www.moxfield.com/decks/AbCd1234EfGh"),
    "AbCd1234EfGh",
  );
  assert.equal(
    extractMoxfieldPublicId("https://moxfield.com/decks/xyz?utm_source=share"),
    "xyz",
  );
  assert.throws(() => extractMoxfieldPublicId("https://example.com/nope"));
});

test("normalizeMoxfieldDeck produces one commander and the full mainboard", () => {
  const deck = normalizeMoxfieldDeck(fixture, "https://www.moxfield.com/decks/fixture-deck-1");
  assert.equal(deck.sourceType, "moxfield");
  assert.equal(deck.commander.length, 1);
  assert.equal(deck.commander[0].name, "Muldrotha, the Gravetide");
  assert.equal(deck.commander[0].setCode, "dom");
  assert.equal(deck.mainboard.length, 6);
  const forest = deck.mainboard.find((c) => c.name === "Forest");
  assert.equal(forest?.quantity, 34);
  assert.equal(forest?.setCode, null);
});

test("normalizeMoxfieldDeck rejects a deck with no commander board entries", () => {
  const noCommander: MoxfieldRawDeck = {
    ...fixture,
    boards: { ...fixture.boards, commanders: { count: 0, cards: {} } },
  };
  assert.throws(() => normalizeMoxfieldDeck(noCommander, "https://example.com/x"));
});

test("toDck renders exact-printing lines with set|collector-number and falls back to name-only otherwise", () => {
  const deck = normalizeMoxfieldDeck(fixture, "https://www.moxfield.com/decks/fixture-deck-1");
  const dck = toDck(deck);

  assert.match(dck, /\[metadata\]/);
  assert.match(dck, /^Name=Fixture: Muldrotha Value Engine$/m);
  assert.match(dck, /\[Commander\]/);
  assert.match(dck, /^1 Muldrotha, the Gravetide\|DOM\|205$/m);
  assert.match(dck, /\[Main\]/);
  assert.match(dck, /^1 Sol Ring\|CMM\|382$/m);
  // No set/collector number on the source card -> name-only fallback line.
  assert.match(dck, /^1 Eternal Witness$/m);
  assert.match(dck, /^34 Forest$/m);

  // Section ordering matters to Forge's parser.
  const sectionOrder = ["[metadata]", "[Avatar]", "[Commander]", "[Main]", "[Sideboard]"];
  let lastIndex = -1;
  for (const section of sectionOrder) {
    const idx = dck.indexOf(section);
    assert.ok(idx > lastIndex, `expected ${section} to appear after the previous section`);
    lastIndex = idx;
  }
});
