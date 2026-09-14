import { test } from "node:test";
import assert from "node:assert/strict";

import { computeGameStats, computeRunSpellsByRoundPerPlayer } from "./gameStats.js";
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

test("computeGameStats: spellsByRound tracks each player's own count per round, not a pod-wide total", () => {
  const events: AnalyticsEvent[] = [
    turnBegan("Alice", 1),
    spellCast("Alice", "Sol Ring", 1),
    spellCast("Alice", "Lightning Bolt", 1),
    // Bob's turn 2 is still round 1 - the round only advances once the
    // observed first-turn player (Alice) comes back around.
    turnBegan("Bob", 2),
    spellCast("Bob", "Counterspell", 2),
  ];
  const stats = computeGameStats(0, events, PLAYERS, {});
  assert.deepEqual(stats.spellsByRound, { 1: { Alice: 2, Bob: 1 } });
});

test("computeRunSpellsByRoundPerPlayer: averages (sums / gamesPlayed) rather than summing raw totals", () => {
  const gameStatsList = [
    computeGameStats(0, [turnBegan("Alice", 1), spellCast("Alice", "Sol Ring", 1)], PLAYERS, {}),
    computeGameStats(
      1,
      [turnBegan("Alice", 1), spellCast("Alice", "Sol Ring", 1), spellCast("Alice", "Lightning Bolt", 1)],
      PLAYERS,
      {},
    ),
  ];
  const result = computeRunSpellsByRoundPerPlayer(gameStatsList, PLAYERS);
  // Alice cast 1 spell round 1 in game 0, 2 spells round 1 in game 1 -> avg (1+2)/2 = 1.5.
  assert.deepEqual(result.Alice, [{ round: 1, count: 1.5 }]);
  // Bob never cast anything in either game - present with an empty series, not omitted.
  assert.deepEqual(result.Bob, []);
});
