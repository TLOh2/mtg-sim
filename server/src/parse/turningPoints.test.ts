import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseGameLog } from "./parseGameLog.js";
import { detectTurningPoints } from "./turningPoints.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_LOG = readFileSync(path.join(here, "..", "..", "fixtures", "sample-game-log.txt"), "utf-8");
const PLAYERS = [
  "Ai(1)-Starter Commander - Red",
  "Ai(2)-Starter Commander - Blue",
  "Ai(3)-Starter Commander - Black",
  "Ai(4)-Starter Commander - Green",
];

test("detects a non-combat elimination in the real captured game (Blood Artist trigger, not combat damage)", () => {
  const events = parseGameLog(REAL_LOG, PLAYERS);
  const points = detectTurningPoints(events);

  const elimination = points.find((p) => p.signalId === "player_elimination" || p.signalId === "lethal_combat");
  assert.ok(elimination, "expected an elimination-type turning point");
  // Blue's final blow (1 -> 0) came from Blood Artist's life-loss trigger,
  // several events after the last actual combat damage to Blue - so this
  // should classify as a plain elimination, not lethal_combat.
  assert.equal(elimination!.signalId, "player_elimination");
  assert.match(elimination!.description, /Blue/);
});

test("large_life_swing: a >=10 life swing in one event is flagged", () => {
  const events = parseGameLog(
    ["Turn: Turn 1 (Ai(1)-A)", "Life: Life: Ai(2)-B 20 > 5"].join("\n"),
    ["Ai(1)-A", "Ai(2)-B"],
  );
  const points = detectTurningPoints(events);
  assert.ok(points.some((p) => p.signalId === "large_life_swing"));
});

test("large_life_swing: a small life change is not flagged", () => {
  const events = parseGameLog(
    ["Turn: Turn 1 (Ai(1)-A)", "Life: Life: Ai(2)-B 20 > 17"].join("\n"),
    ["Ai(1)-A", "Ai(2)-B"],
  );
  assert.equal(detectTurningPoints(events).filter((p) => p.signalId === "large_life_swing").length, 0);
});

test("extra_turn: the same player taking two turns in a row is flagged", () => {
  const events = parseGameLog(
    [
      "Turn: Turn 1 (Ai(1)-A)",
      "Turn: Turn 2 (Ai(2)-B)",
      "Turn: Turn 3 (Ai(2)-B)", // Ai(2)-B again immediately -> extra turn
      "Turn: Turn 4 (Ai(1)-A)",
    ].join("\n"),
    ["Ai(1)-A", "Ai(2)-B"],
  );
  const points = detectTurningPoints(events);
  assert.equal(points.filter((p) => p.signalId === "extra_turn").length, 1);
});

test("board_wipe: several creatures dying to the graveyard with no combat nearby", () => {
  const log = [
    "Turn: Turn 5 (Ai(1)-A)",
    "Add To Stack: Ai(1)-A cast Blasphemous Act",
    "Resolve Stack: Blasphemous Act",
    "Zone Change: Bear (1) was put into Graveyard from Battlefield.",
    "Zone Change: Wolf (2) was put into Graveyard from Battlefield.",
    "Zone Change: Elf (3) was put into Graveyard from Battlefield.",
    "Zone Change: Goblin (4) was put into Graveyard from Battlefield.",
  ].join("\n");
  const points = detectTurningPoints(parseGameLog(log, ["Ai(1)-A"]));
  assert.ok(points.some((p) => p.signalId === "board_wipe"));
});

test("mass_land_destruction: clustered land deaths near a spell whose text mentions 'land'", () => {
  const log = [
    "Turn: Turn 5 (Ai(1)-A)",
    "Add To Stack: Ai(1)-A cast Armageddon",
    "Resolve Stack: Armageddon - Destroy all lands.",
    "Zone Change: Forest (1) was put into Graveyard from Battlefield.",
    "Zone Change: Island (2) was put into Graveyard from Battlefield.",
    "Zone Change: Mountain (3) was put into Graveyard from Battlefield.",
  ].join("\n");
  const points = detectTurningPoints(parseGameLog(log, ["Ai(1)-A"]));
  assert.ok(points.some((p) => p.signalId === "mass_land_destruction"));
});

test("combo_loop_detected: the same stack action repeating many times in a short window", () => {
  const repeatedLine = "Add To Stack: Ai(1)-A activated Basalt Monolith";
  const log = ["Turn: Turn 5 (Ai(1)-A)", ...Array(5).fill(repeatedLine)].join("\n");
  const points = detectTurningPoints(parseGameLog(log, ["Ai(1)-A"]));
  assert.ok(points.some((p) => p.signalId === "combo_loop_detected"));
});

test("key_counterspell: a resolved counter effect is flagged", () => {
  const log = [
    "Turn: Turn 5 (Ai(1)-A)",
    "Add To Stack: Ai(2)-B cast Cyclonic Rift",
    "Add To Stack: Ai(1)-A cast Counterspell",
    "Resolve Stack: Counter target spell.",
  ].join("\n");
  const points = detectTurningPoints(parseGameLog(log, ["Ai(1)-A", "Ai(2)-B"]));
  assert.ok(points.some((p) => p.signalId === "key_counterspell"));
});

test("commander_cast_or_recast: casting a card from the commander list is flagged", () => {
  const log = ["Turn: Turn 5 (Ai(1)-A)", "Add To Stack: Ai(1)-A cast Muldrotha, the Gravetide"].join("\n");
  const points = detectTurningPoints(parseGameLog(log, ["Ai(1)-A"]), {
    commandersByPlayer: { "Ai(1)-A": ["Muldrotha, the Gravetide"] },
  });
  assert.ok(points.some((p) => p.signalId === "commander_cast_or_recast"));
});
