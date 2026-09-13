import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseGameLog } from "./parseGameLog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// A real (not synthetic) capture from a Forge 4-player Commander game, taken
// during Phase 0 manual testing - see PROGRESS.md / engine/NOTES.md. Two
// separate excerpts of the same real game (an early turn, then the ending)
// spliced together for a compact fixture, so turn numbers jump - that jump
// is a fixture artifact, not something the parser should read meaning into.
const REAL_LOG = readFileSync(path.join(here, "..", "..", "fixtures", "sample-game-log.txt"), "utf-8");

const PLAYERS = [
  "Ai(1)-Starter Commander - Red",
  "Ai(2)-Starter Commander - Blue",
  "Ai(3)-Starter Commander - Black",
  "Ai(4)-Starter Commander - Green",
];

test("parseGameLog classifies lines by Forge's GameLogEntryType captions", () => {
  const events = parseGameLog(REAL_LOG, PLAYERS);

  const types = new Set(events.map((e) => e.type));
  for (const expected of [
    "TURN",
    "PHASE",
    "LAND",
    "MANA",
    "STACK_ADD",
    "STACK_RESOLVE",
    "COMBAT",
    "DAMAGE",
    "LIFE",
    "ZONE_CHANGE",
    "PLAYER_CONTROL",
    "GAME_OUTCOME",
    "MATCH_RESULTS",
  ]) {
    assert.ok(types.has(expected as any), `expected a ${expected} event to be classified`);
  }

  // "Simulation mode" and the vs-header line match no known caption.
  assert.ok(events.some((e) => e.type === "UNCLASSIFIED"));
});

test("parseGameLog tracks the current turn number across subsequent events", () => {
  const events = parseGameLog(REAL_LOG, PLAYERS);
  const landEvent = events.find((e) => e.type === "LAND");
  assert.equal(landEvent?.turn, 2);

  const lastLifeEvent = events.filter((e) => e.type === "LIFE").at(-1);
  assert.equal(lastLifeEvent?.turn, 60);
});

test("parseGameLog identifies exactly the players named in a line via the roster", () => {
  const events = parseGameLog(REAL_LOG, PLAYERS);
  const attackEvent = events.find((e) => e.raw.startsWith("Combat: Ai(3)"));
  assert.ok(attackEvent);
  assert.deepEqual(
    [...attackEvent!.playersInvolved].sort(),
    ["Ai(2)-Starter Commander - Blue", "Ai(3)-Starter Commander - Black"].sort(),
  );
});
