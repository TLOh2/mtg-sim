import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAwards } from "./awards.js";
import type { DeckAggregateStats } from "./gameStats.js";

function deck(overrides: Partial<DeckAggregateStats> & { player: string }): DeckAggregateStats {
  return {
    gamesPlayed: 3,
    wins: 0,
    winRate: 0,
    avgMulligans: 0,
    avgLandsPlayed: 0,
    avgSpellsCast: 0,
    avgFirstSpellCastTurn: null,
    avgCommanderCastTurn: null,
    avgEliminatedTurnWhenLost: null,
    avgCombatDamageDealt: 0,
    avgNonCombatDamageDealt: 0,
    avgCommanderDamageDealt: 0,
    avgNonDamageLifeLossDealt: 0,
    avgFirstCombatDamageDealtTurn: null,
    avgWinningGameTurn: null,
    avgFinishPosition: null,
    avgMissedLandDrops: 0,
    avgLandsInHandAtEnd: 0,
    avgManaThresholdTurns: { five: null, seven: null, ten: null },
    avgManaEfficiency: null,
    avgCurveEfficiency: null,
    manaIssueFlag: false,
    powerBracketEstimate: 2.5,
    ...overrides,
  };
}

test("computeAwards: Most Damage Dealt goes to the highest combat+non-combat total", () => {
  const aggregate = [
    deck({ player: "Alice", avgCombatDamageDealt: 10, avgNonCombatDamageDealt: 0 }),
    deck({ player: "Bob", avgCombatDamageDealt: 5, avgNonCombatDamageDealt: 8 }), // 13 total, wins
  ];
  const awards = computeAwards(aggregate);
  const mostDamage = awards.find((a) => a.id === "most-damage");
  assert.equal(mostDamage?.player, "Bob");
  assert.equal(mostDamage?.value, "13.0 dmg/game");
});

test("computeAwards: Speedrunner is omitted when no deck has ever won a game", () => {
  const aggregate = [deck({ player: "Alice", avgWinningGameTurn: null }), deck({ player: "Bob", avgWinningGameTurn: null })];
  const awards = computeAwards(aggregate);
  assert.equal(awards.some((a) => a.id === "speedrunner"), false);
});

test("computeAwards: Speedrunner goes to the lowest avgWinningGameTurn", () => {
  const aggregate = [
    deck({ player: "Alice", avgWinningGameTurn: 9 }),
    deck({ player: "Bob", avgWinningGameTurn: 5 }),
  ];
  const awards = computeAwards(aggregate);
  const speedrunner = awards.find((a) => a.id === "speedrunner");
  assert.equal(speedrunner?.player, "Bob");
  assert.equal(speedrunner?.value, "turn 5.0");
});

test("computeAwards: Pyromaniac and Iron Bank are omitted when every deck is at zero (no real signal)", () => {
  const aggregate = [deck({ player: "Alice" }), deck({ player: "Bob" })];
  const awards = computeAwards(aggregate);
  assert.equal(awards.some((a) => a.id === "pyromaniac"), false);
  assert.equal(awards.some((a) => a.id === "iron-bank"), false);
  assert.equal(awards.some((a) => a.id === "most-damage"), false);
  assert.equal(awards.some((a) => a.id === "rocky-start"), false);
});

test("computeAwards: Most Consistent is omitted entirely for a run with no turn_snapshot data", () => {
  // avgManaEfficiency null on every deck simulates an older run predating turn_snapshot.
  const aggregate = [deck({ player: "Alice", avgManaEfficiency: null }), deck({ player: "Bob", avgManaEfficiency: null })];
  const awards = computeAwards(aggregate);
  assert.equal(awards.some((a) => a.id === "most-consistent"), false);
});

test("computeAwards: Most Consistent can be won with a genuine zero missed land drops (0 is a valid winning value, not 'no signal')", () => {
  const aggregate = [
    deck({ player: "Alice", avgManaEfficiency: 1.1, avgMissedLandDrops: 0 }),
    deck({ player: "Bob", avgManaEfficiency: 0.9, avgMissedLandDrops: 2 }),
  ];
  const awards = computeAwards(aggregate);
  const consistent = awards.find((a) => a.id === "most-consistent");
  assert.equal(consistent?.player, "Alice");
  assert.equal(consistent?.value, "0.0 missed drops/game");
});

test("computeAwards: Rocky Start goes to the most mulligans", () => {
  const aggregate = [
    deck({ player: "Alice", avgMulligans: 0.3 }),
    deck({ player: "Bob", avgMulligans: 1.7 }),
  ];
  const awards = computeAwards(aggregate);
  const rocky = awards.find((a) => a.id === "rocky-start");
  assert.equal(rocky?.player, "Bob");
});
