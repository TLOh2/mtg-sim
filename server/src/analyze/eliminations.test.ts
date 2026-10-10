import { test } from "node:test";
import assert from "node:assert/strict";

import { computeEliminations } from "./eliminations.js";
import type { AnalyticsEvent, GameEvent } from "../parse/types.js";

const A = "Ai(1)-Alpha";
const B = "Ai(2)-Beta Deck";
const commanders = { [A]: ["Alpha Commander"], [B]: ["Beta Commander"] };

function outcome(raw: string): GameEvent {
  return { turn: 0, index: 0, type: "GAME_OUTCOME", raw: `Game Outcome: ${raw}`, playersInvolved: [] };
}
const turn = (player: string, n: number): AnalyticsEvent => ({ type: "turn_began", turn: n, player });
const dmg = (target: string, source: string, amount: number, combat = true, infect = false): AnalyticsEvent => ({
  type: "player_damaged", target, source, amount, combat, infect,
});
const life = (player: string, oldLife: number, newLife: number, isDamage: boolean, source: string | null = null): AnalyticsEvent => ({
  type: "life_change", player, oldLife, newLife, source, isDamage,
});
const attack = (player: string, ...cards: string[]): AnalyticsEvent => ({
  type: "attackers_declared", player, attacks: cards.map((card) => ({ card, defender: "x" })),
});

test("every source in the lethal combat batch is a finisher, biggest first, grouping same-named tokens", () => {
  const events = [
    turn(A, 1), turn(B, 2),
    dmg(B, "Grizzly Bears", 2), life(B, 40, 38, true),
    turn(A, 3),
    attack(A, "Goblin Token", "Goblin Token", "Ghalta"),
    dmg(B, "Goblin Token", 1), dmg(B, "Ghalta", 12), dmg(B, "Goblin Token", 1),
    life(B, 10, -4, true),
  ];
  const [e] = computeEliminations(events, [outcome(`${B} has lost because life total reached -4`)], commanders);
  assert.equal(e.player, B);
  assert.equal(e.cause, "damage");
  assert.equal(e.by, A);
  assert.equal(e.turn, 2);
  assert.deepEqual(e.cards, [
    { card: "Ghalta", amount: 12, count: 1 },
    { card: "Goblin Token", amount: 2, count: 2 },
  ]);
});

test("damage dealt to a player earlier doesn't leak into a later finishing batch", () => {
  const events = [
    turn(A, 1),
    dmg(B, "Shock", 2, false), life(B, 5, 3, true),
    dmg(B, "Lightning Bolt", 3, false), life(B, 3, 0, true),
  ];
  const [e] = computeEliminations(events, [outcome(`${B} has lost because life total reached 0`)], commanders);
  assert.deepEqual(e.cards.map((c) => c.card), ["Lightning Bolt"]);
});

test("a drain knockout names the draining card", () => {
  const events = [
    turn(A, 1),
    { type: "zone_change", card: "Gray Merchant", controller: A, from: "Stack", to: "Battlefield" },
    life(B, 3, -1, false, "Gray Merchant"),
  ];
  const [e] = computeEliminations(events, [outcome(`${B} has lost because life total reached -1`)], commanders);
  assert.equal(e.cause, "life loss");
  assert.equal(e.by, A);
  assert.deepEqual(e.cards, [{ card: "Gray Merchant", amount: 4, count: 1 }]);
});

test("commander damage is credited to the commander that dealt the 21st point", () => {
  const events = [
    turn(A, 1), attack(A, "Alpha Commander"), dmg(B, "Alpha Commander", 11), life(B, 40, 29, true),
    turn(A, 2), attack(A, "Alpha Commander"), dmg(B, "Alpha Commander", 10), life(B, 29, 19, true),
  ];
  const [e] = computeEliminations(
    events,
    [outcome(`${B} has lost due to accumulation of 21 damage from generals`)],
    commanders,
  );
  assert.equal(e.cause, "commander damage");
  assert.equal(e.by, A);
  assert.equal(e.turn, 2);
  assert.deepEqual(e.cards.map((c) => c.card), ["Alpha Commander"]);
});

test("decking out has no finisher card, and each loser is reported once in knockout order", () => {
  const events = [
    turn(A, 1),
    dmg(B, "Fireball", 40, false), life(B, 40, 0, true),
  ];
  const result = computeEliminations(
    events,
    [
      outcome(`${A} has lost trying to draw cards from empty library`),
      outcome(`${B} has lost because life total reached 0`),
      outcome(`${B} has lost because life total reached 0`),
    ],
    commanders,
  );
  assert.deepEqual(result.map((e) => [e.player, e.cause]), [[B, "damage"], [A, "decked"]]);
  assert.deepEqual(result[1].cards, []);
});
