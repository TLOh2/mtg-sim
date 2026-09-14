import { test } from "node:test";
import assert from "node:assert/strict";

import { computeGameStats, computeRunAggregateStats, computeRunSpellsByRoundPerPlayer } from "./gameStats.js";
import type { AnalyticsEvent } from "../parse/types.js";
import type { AnalyzedGame } from "./types.js";

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

test("computeGameStats: firstCommanderCastTurn is the FIRST cast, even when the commander dies and gets recast later the same game", () => {
  const events: AnalyticsEvent[] = [
    turnBegan("Alice", 1),
    turnBegan("Bob", 2),
    turnBegan("Alice", 3),
    spellCast("Alice", "Atraxa, Praetors' Voice", 4), // first cast, round 2
    turnBegan("Bob", 4),
    turnBegan("Alice", 5),
    spellCast("Alice", "Atraxa, Praetors' Voice", 5), // recast from the command zone after dying, round 3
  ];
  const stats = computeGameStats(0, events, PLAYERS, { Alice: ["Atraxa, Praetors' Voice"] });
  const alice = stats.players.find((p) => p.player === "Alice")!;
  assert.equal(alice.firstCommanderCastTurn, 2);
  // The raw array still records every cast - just isn't what gets averaged.
  assert.deepEqual(alice.commanderCastTurns, [2, 3]);
});

test("computeRunAggregateStats: avgCommanderCastTurn averages the first cast per game, not every recast", () => {
  const commandersByPlayer = { Alice: ["Atraxa, Praetors' Voice"] };
  // Game 0: commander cast turn 3, dies, recast turn 8 - a naive
  // flatten-and-average would pull the "how fast do I get it out" signal
  // toward 5.5, when the deck actually gets it out turn 3 every time.
  const game0Events: AnalyticsEvent[] = [
    turnBegan("Alice", 1),
    turnBegan("Alice", 2),
    turnBegan("Alice", 3),
    spellCast("Alice", "Atraxa, Praetors' Voice", 4),
    turnBegan("Alice", 4),
    turnBegan("Alice", 5),
    turnBegan("Alice", 6),
    turnBegan("Alice", 7),
    turnBegan("Alice", 8),
    spellCast("Alice", "Atraxa, Praetors' Voice", 4),
  ];
  // Game 1: cast once, turn 3.
  const game1Events: AnalyticsEvent[] = [
    turnBegan("Alice", 1),
    turnBegan("Alice", 2),
    turnBegan("Alice", 3),
    spellCast("Alice", "Atraxa, Praetors' Voice", 4),
  ];
  const gs0 = computeGameStats(0, game0Events, PLAYERS, commandersByPlayer);
  const gs1 = computeGameStats(1, game1Events, PLAYERS, commandersByPlayer);
  const gameStatsByIndex = new Map([
    [0, gs0],
    [1, gs1],
  ]);
  const games: Pick<AnalyzedGame, "gameIndex" | "winnerName" | "isDraw">[] = [
    { gameIndex: 0, winnerName: null, isDraw: true },
    { gameIndex: 1, winnerName: null, isDraw: true },
  ];
  const aggregate = computeRunAggregateStats(games, gameStatsByIndex, PLAYERS);
  const alice = aggregate.find((a) => a.player === "Alice")!;
  // (3 + 3) / 2 = 3, not (3 + 8 + 3) / 3 = 4.67.
  assert.equal(alice.avgCommanderCastTurn, 3);
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
