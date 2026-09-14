import { test } from "node:test";
import assert from "node:assert/strict";

import { computeGameStats } from "./gameStats.js";
import type { AnalyticsEvent } from "../parse/types.js";

const PLAYERS = ["Alice", "Bob"];

function turnBegan(player: string, turn: number): AnalyticsEvent {
  return { type: "turn_began", player, turn };
}

function spellCast(player: string, card: string, manaValue: number): AnalyticsEvent {
  return { type: "spell_cast", player, card, action: "cast", manaValue };
}

test("computeGameStats: avgCurveEfficiency is (mana value / round) averaged across a player's own spells", () => {
  const events: AnalyticsEvent[] = [
    turnBegan("Alice", 1),
    spellCast("Alice", "Sol Ring", 1), // round 1: 1/1 = 1
    turnBegan("Bob", 2),
    turnBegan("Alice", 3),
    spellCast("Alice", "Kozilek's Predator", 9), // round 2 (Alice's second turn): 9/2 = 4.5
  ];
  const stats = computeGameStats(0, events, PLAYERS, {});
  const alice = stats.players.find((p) => p.player === "Alice");
  assert.ok(alice);
  // avg(1, 4.5) = 2.75
  assert.equal(alice!.avgCurveEfficiency, 2.75);
});

test("computeGameStats: spells cast at round 0 (before the first turn_began) don't count toward curve efficiency", () => {
  const events: AnalyticsEvent[] = [
    spellCast("Alice", "Ornithopter", 0), // round 0 - would be a divide-by-zero, must be excluded
    turnBegan("Alice", 1),
    spellCast("Alice", "Lightning Bolt", 1), // round 1: 1/1 = 1
  ];
  const stats = computeGameStats(0, events, PLAYERS, {});
  const alice = stats.players.find((p) => p.player === "Alice");
  assert.equal(alice!.avgCurveEfficiency, 1);
});

test("computeGameStats: a player who cast nothing has a null avgCurveEfficiency, not zero", () => {
  const events: AnalyticsEvent[] = [turnBegan("Alice", 1)];
  const stats = computeGameStats(0, events, PLAYERS, {});
  const bob = stats.players.find((p) => p.player === "Bob");
  assert.equal(bob!.avgCurveEfficiency, null);
});
