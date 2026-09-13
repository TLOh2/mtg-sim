import { test } from "node:test";
import assert from "node:assert/strict";

import { parseGameResults } from "./parseGameResults.js";

test("parseGameResults splits a multi-game batch into per-game results", () => {
  const stdout = [
    "Simulation mode",
    "Ai(1)-Deck A vs Ai(2)-Deck B - 3 games of Commander",
    "Turn: Turn 1 (Ai(1)-Deck A)",
    "Phase: Ai(1)-Deck A's Untap step",
    "Game Outcome: Ai(2)-Deck B has won because all opponents have lost",
    "Game Result: Game 1 ended in 22457 ms. Ai(2)-Deck B has won!",
    "",
    "Turn: Turn 1 (Ai(1)-Deck A)",
    "Game Result: Game 2 ended in a Draw! Took 120000 ms.",
    "",
    "Turn: Turn 1 (Ai(1)-Deck A)",
    "Game Result: Game 3 ended in 8551 ms. Ai(1)-Deck A has won!",
    "",
  ].join("\n");

  const games = parseGameResults(stdout);

  assert.equal(games.length, 3);

  assert.equal(games[0].gameIndex, 1);
  assert.equal(games[0].winnerName, "Ai(2)-Deck B");
  assert.equal(games[0].isDraw, false);
  assert.equal(games[0].durationMs, 22457);
  assert.match(games[0].rawLog, /^Simulation mode/);
  assert.match(games[0].rawLog, /Game Result: Game 1/);

  assert.equal(games[1].gameIndex, 2);
  assert.equal(games[1].winnerName, null);
  assert.equal(games[1].isDraw, true);
  assert.equal(games[1].durationMs, 120000);
  // Game 2's segment should not include game 1's lines.
  assert.doesNotMatch(games[1].rawLog, /Game Result: Game 1/);

  assert.equal(games[2].gameIndex, 3);
  assert.equal(games[2].winnerName, "Ai(1)-Deck A");
  assert.equal(games[2].durationMs, 8551);
});

test("parseGameResults returns an empty list for output with no completed games", () => {
  assert.deepEqual(parseGameResults("Simulation mode\nCould not load deck - x.dck"), []);
});
