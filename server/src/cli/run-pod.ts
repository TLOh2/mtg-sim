#!/usr/bin/env node
// CLI: run a batch of Commander games for a 4-deck pod through Forge and
// print structured results. See spec.json#simulation_defaults for the
// pod-size/games-per-batch defaults this mirrors.
//
// Usage: npm run sim:pod -- <run-id> <deck1.dck> <deck2.dck> <deck3.dck> <deck4.dck> [games] [clockSeconds]
import path from "node:path";
import { runForgeBatch } from "../simulate/forgeRunner.js";

async function main() {
  const [runId, d1, d2, d3, d4, gamesArg, clockArg] = process.argv.slice(2);
  if (!runId || !d1 || !d2 || !d3 || !d4) {
    console.error(
      "Usage: run-pod <run-id> <deck1.dck> <deck2.dck> <deck3.dck> <deck4.dck> [games=20] [clockSeconds=180]",
    );
    process.exit(1);
  }
  const games = gamesArg ? Number(gamesArg) : 20;
  const clockSeconds = clockArg ? Number(clockArg) : 180;

  console.error(`Running ${games} game(s) for pod '${runId}' (this can take a while)...`);
  // forgeRunner spawns engine/run-sim.sh with the repo root as its cwd, so
  // deck paths given relative to *this process's* cwd must be made absolute
  // first (otherwise they'd resolve relative to the wrong directory).
  const deckPaths = [d1, d2, d3, d4].map((p) => path.resolve(process.cwd(), p));
  const result = await runForgeBatch(deckPaths, {
    runId,
    games,
    format: "Commander",
    clockSeconds,
  });

  const { rawStdout: _drop, ...summary } = result;
  console.log(
    JSON.stringify(
      {
        ...summary,
        games: summary.games.map(({ rawLog: _dropLog, ...g }) => g),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Batch run failed:", err.message ?? err);
  process.exit(1);
});
