import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { listDecks, getDeck, saveDeck, SAVED_DECKS_DIR, PRESET_DECKS_DIR } from "./deckLibrary.js";

/**
 * server/presets/decks/ ships empty (no repo-committed example decks), so
 * these tests write a throwaway preset file directly into that directory to
 * exercise the "reads baked-in presets from disk" mechanism, rather than
 * depending on a checked-in example deck.
 */
function withTempPreset<T>(id: string, label: string, decklistText: string, run: () => T): T {
  const filePath = path.join(PRESET_DECKS_DIR, `${id}.json`);
  writeFileSync(
    filePath,
    JSON.stringify({ id, label, decklistText, savedAt: "2025-01-01T00:00:00.000Z" }),
    "utf-8",
  );
  try {
    return run();
  } finally {
    rmSync(filePath, { force: true });
  }
}

test("listDecks includes a baked-in preset deck", () => {
  withTempPreset("temp-preset-test", "Temp Preset", "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301", () => {
    const decks = listDecks();
    const preset = decks.find((d) => d.id === "temp-preset-test");
    assert.ok(preset, "expected the baked-in preset to be listed");
    assert.equal(preset?.label, "Temp Preset");
    assert.equal(preset?.commanderPreview, "Sol Ring");
  });
});

test("getDeck finds a baked-in preset by id", () => {
  withTempPreset("temp-preset-test", "Temp Preset", "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301", () => {
    const deck = getDeck("temp-preset-test");
    assert.ok(deck);
    assert.match(deck!.decklistText, /Sol Ring/);
  });
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

test("saveDeck reuses an existing entry with the exact same decklist text instead of duplicating it", () => {
  const text = "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301";
  const first = saveDeck("First Paste", text);
  try {
    const second = saveDeck("First Paste", text);
    assert.equal(second.id, first.id, "pasting identical text again should return the same entry, not a new one");
    assert.equal(listDecks().filter((d) => d.decklistText.trim() === text).length, 1);
  } finally {
    rmSync(`${SAVED_DECKS_DIR}/${first.id}.json`, { force: true });
  }
});

test("saveDeck upgrades a generic 'Player N' label when the same decklist is later saved with a real name", () => {
  const text = "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301\n1 more unique card for this test";
  const first = saveDeck("Player 3", text);
  try {
    const second = saveDeck("Actually A Real Name", text);
    assert.equal(second.id, first.id);
    assert.equal(second.label, "Actually A Real Name");
    assert.equal(getDeck(first.id)?.label, "Actually A Real Name");
  } finally {
    rmSync(`${SAVED_DECKS_DIR}/${first.id}.json`, { force: true });
  }
});

test("saveDeck does NOT overwrite an existing real label with a new generic one", () => {
  const text = "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301\n1 another unique card for this test";
  const first = saveDeck("Real Name First", text);
  try {
    const second = saveDeck("Player 2", text);
    assert.equal(second.id, first.id);
    assert.equal(second.label, "Real Name First");
  } finally {
    rmSync(`${SAVED_DECKS_DIR}/${first.id}.json`, { force: true });
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
