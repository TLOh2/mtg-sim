import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDeckLeaderboard } from "./deckLeaderboard.js";
import type { AnalyzedGame, RunSummary } from "./types.js";

const PLAYERS = ["Alice", "Bob"];

function game(gameIndex: number, winnerName: string | null): AnalyzedGame {
  return {
    gameIndex,
    winnerName,
    isDraw: false,
    durationMs: 1000,
    events: [],
    turningPoints: [],
    rawLog: "",
    analyticsEvents: [],
  };
}

function run(runId: string, createdAt: string, winnerNames: (string | null)[]): RunSummary {
  return {
    runId,
    createdAt,
    status: "complete",
    deckPaths: [],
    playerNames: PLAYERS,
    requestedGames: winnerNames.length,
    completedGames: winnerNames.length,
    winsByPlayer: {},
    games: winnerNames.map((w, i) => game(i, w)),
  };
}

test("computeDeckLeaderboard: winRateStdDev is null with only one run (spread is undefined for one data point)", () => {
  const runs = [run("r1", "2026-01-01T00:00:00Z", ["Alice"])];
  const [alice] = computeDeckLeaderboard(runs).filter((e) => e.label === "Alice");
  assert.equal(alice.runsPlayed, 1);
  assert.equal(alice.winRateStdDev, null);
});

test("computeDeckLeaderboard: winRateStdDev is 0 for a deck with an identical win rate every run", () => {
  const runs = [
    run("r1", "2026-01-01T00:00:00Z", ["Alice", "Bob"]), // Alice 50%
    run("r2", "2026-01-02T00:00:00Z", ["Alice", "Bob"]), // Alice 50%
  ];
  const [alice] = computeDeckLeaderboard(runs).filter((e) => e.label === "Alice");
  assert.equal(alice.winRateStdDev, 0);
});

test("computeDeckLeaderboard: winRateStdDev is positive for a deck that swings between dominating and whiffing", () => {
  const runs = [
    run("r1", "2026-01-01T00:00:00Z", ["Alice", "Alice"]), // Alice 100%
    run("r2", "2026-01-02T00:00:00Z", ["Bob", "Bob"]), // Alice 0%
  ];
  const [alice] = computeDeckLeaderboard(runs).filter((e) => e.label === "Alice");
  // mean win rate 0.5, deviations of 0.5 each way -> population stddev 0.5.
  assert.equal(alice.winRateStdDev, 0.5);
});
