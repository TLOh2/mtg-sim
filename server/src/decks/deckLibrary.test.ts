import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { listDecks, getDeck, saveDeck, SAVED_DECKS_DIR } from "./deckLibrary.js";

test("listDecks includes the baked-in preset deck", () => {
  const decks = listDecks();
  const eowyn = decks.find((d) => d.id === "eowyn-ayo-win");
  assert.ok(eowyn, "expected the baked-in eowyn-ayo-win preset to be listed");
  assert.equal(eowyn?.label, "Ayo, Win");
  assert.equal(eowyn?.commanderPreview, "Éowyn, Shieldmaiden");
});

test("getDeck finds a baked-in preset by id", () => {
  const deck = getDeck("eowyn-ayo-win");
  assert.ok(deck);
  assert.match(deck!.decklistText, /Éowyn, Shieldmaiden/);
});

test("getDeck returns null for an unknown id", () => {
  assert.equal(getDeck("no-such-deck-id"), null);
});

test("saveDeck persists a new deck that listDecks and getDeck then see", () => {
  const saved = saveDeck("Test Deck", "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301");
  try {
    assert.ok(saved.id);
    assert.equal(saved.label, "Test Deck");

    const found = getDeck(saved.id);
    assert.equal(found?.decklistText, saved.decklistText);

    const listed = listDecks().find((d) => d.id === saved.id);
    assert.ok(listed, "newly saved deck should appear in listDecks()");
  } finally {
    rmSync(`${SAVED_DECKS_DIR}/${saved.id}.json`, { force: true });
  }
});

test("saveDeck still saves unparseable text, just without a commander preview", () => {
  const saved = saveDeck("Garbage", "not a decklist");
  try {
    assert.equal(saved.commanderPreview, undefined);
  } finally {
    rmSync(`${SAVED_DECKS_DIR}/${saved.id}.json`, { force: true });
  }
});

test("a hand-written preset file missing commanderPreview gets one computed on read", () => {
  const id = "test-hand-written-preset";
  const filePath = path.join(SAVED_DECKS_DIR, `${id}.json`);
  writeFileSync(
    filePath,
    JSON.stringify({
      id,
      label: "Hand-written",
      decklistText: "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301",
      savedAt: "2025-01-01T00:00:00.000Z",
    }),
    "utf-8",
  );
  try {
    assert.equal(getDeck(id)?.commanderPreview, "Sol Ring");
    assert.equal(listDecks().find((d) => d.id === id)?.commanderPreview, "Sol Ring");
  } finally {
    rmSync(filePath, { force: true });
  }
});
