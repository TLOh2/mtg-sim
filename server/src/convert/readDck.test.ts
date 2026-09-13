import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { readDckSummary, buildPlayerRoster } from "./readDck.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Real .dck files bundled with the Forge submodule (see engine/NOTES.md) -
// used here rather than a hand-written fixture since they're guaranteed
// valid and already used elsewhere in the project's own smoke tests.
const PRECON_DIR = path.join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "forge",
  "forge-gui",
  "res",
  "adventure",
  "common",
  "decks",
  "starter",
  "commander",
);

test("readDckSummary reads the deck name and commander from a real Forge precon", () => {
  const summary = readDckSummary(path.join(PRECON_DIR, "red_01.dck"));
  assert.equal(summary.name, "Starter Commander - Red");
  assert.deepEqual(summary.commanderNames, ["Anax, Hardened in the Forge"]);
});

test("buildPlayerRoster names players the same way Forge's sim mode does", () => {
  const { playerNames, commandersByPlayer } = buildPlayerRoster([
    path.join(PRECON_DIR, "red_01.dck"),
    path.join(PRECON_DIR, "blue_01.dck"),
  ]);
  assert.deepEqual(playerNames, ["Ai(1)-Starter Commander - Red", "Ai(2)-Starter Commander - Blue"]);
  assert.deepEqual(commandersByPlayer["Ai(1)-Starter Commander - Red"], ["Anax, Hardened in the Forge"]);
});
