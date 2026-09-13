#!/usr/bin/env node
// CLI: run a pod batch through Forge (Phase 2), parse + analyze every
// completed game's real log (Phase 3), and persist the result to
// data/runs/<run-id>.json for the dashboard (Phase 4) to read.
//
// Usage: npm run analyze:pod -- <run-id> <deck1.dck> <deck2.dck> <deck3.dck> <deck4.dck> [games=20] [clockSeconds=180]
import path from "node:path";
import { runAndAnalyzePod } from "../analyze/runAndAnalyzePod.js";

async function main() {
  const [runId, d1, d2, d3, d4, gamesArg, clockArg] = process.argv.slice(2);
  if (!runId || !d1 || !d2 || !d3 || !d4) {
    console.error(
      "Usage: analyze-pod <run-id> <deck1.dck> <deck2.dck> <deck3.dck> <deck4.dck> [games=20] [clockSeconds=180]",
    );
    process.exit(1);
  }
  const games = gamesArg ? Number(gamesArg) : 20;
  const clockSeconds = clockArg ? Number(clockArg) : 180;
  const deckPaths = [d1, d2, d3, d4].map((p) => path.resolve(process.cwd(), p));

  console.error(`Running ${games} game(s) for pod '${runId}' (this can take a while)...`);
  const summary = await runAndAnalyzePod({ runId, deckPaths, games, clockSeconds });

  console.error(`Wrote data/runs/${runId}.json`);
  console.log(
    JSON.stringify(
      {
        runId: summary.runId,
        completedGames: summary.completedGames,
        winsByPlayer: summary.winsByPlayer,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Batch analysis failed:", err.message ?? err);
  process.exit(1);
});
