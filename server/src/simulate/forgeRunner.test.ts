import { test } from "node:test";
import assert from "node:assert/strict";

import { effectiveClockSeconds, parallelBatchCount, splitGames } from "./forgeRunner.js";

test("the clock is only stretched when games actually share the machine", () => {
  assert.equal(effectiveClockSeconds(180, 1), 180);
  assert.equal(effectiveClockSeconds(180, 2), 270);
  assert.equal(effectiveClockSeconds(180, 5), 270);
});

test("splitGames divides games near-evenly and never loses or invents a game", () => {
  assert.deepEqual(splitGames(100, 5), [20, 20, 20, 20, 20]);
  assert.deepEqual(splitGames(20, 3), [7, 7, 6]);
  assert.deepEqual(splitGames(3, 5), [1, 1, 1]);
  for (const [games, batches] of [[1, 1], [7, 4], [50, 6], [99, 5]]) {
    assert.equal(splitGames(games, batches).reduce((a, b) => a + b, 0), games);
  }
});

test("parallelBatchCount honours FORGE_PARALLEL_BATCHES but never exceeds the game count", () => {
  const saved = process.env.FORGE_PARALLEL_BATCHES;
  try {
    process.env.FORGE_PARALLEL_BATCHES = "4";
    assert.equal(parallelBatchCount(100), 4);
    assert.equal(parallelBatchCount(2), 2);
    process.env.FORGE_PARALLEL_BATCHES = "1";
    assert.equal(parallelBatchCount(100), 1);
    delete process.env.FORGE_PARALLEL_BATCHES;
    const auto = parallelBatchCount(100);
    assert.ok(auto >= 1 && auto <= 100);
    assert.equal(parallelBatchCount(1), 1);
  } finally {
    if (saved === undefined) delete process.env.FORGE_PARALLEL_BATCHES;
    else process.env.FORGE_PARALLEL_BATCHES = saved;
  }
});
