#!/usr/bin/env node
// One-off (kept around in case it's needed again) data-repair script: older
// runs pasted a deck without filling in the optional "name this deck"
// field, which fell back to a bare "Player N" - confusing to look at later,
// especially across several runs at once. startPodFromDecklistText.ts now
// falls back to the commander's own name instead for new runs; this script
// applies the same fix to already-persisted runs, which already recorded
// the real commander in commandersByPlayer - just under the wrong display
// name everywhere else in the file.
//
// A first version of this script only fixed the "outer" summary fields
// (playerNames, winsByPlayer, deckUrls, commandersByPlayer, each game's
// winnerName) - a real bug found immediately after: every per-game stat
// (mulligans, lands played, mana, damage, ...) comes from computeGameStats
// walking each game's raw analyticsEvents, and those events still carried
// the OLD "Ai(N)-Player N" string in their own player/owner/target/
// winningPlayer fields. computeGameStats keys its per-player map off the
// (now-renamed) playerNames list, so every event's player lookup silently
// missed and the whole deck diagnostics/mana section read as all
// zeros/nulls - exactly what "why does this run have no stats" turned out
// to be. Fixed by finding the leftover "Ai(N)-Player N" pattern anywhere
// in the run's full JSON text (rawLog and every game's analyticsEvents
// included, not just the summary-level fields) and replacing it wholesale
// with whatever playerNames[N-1] currently says - safe and simple because
// "Ai(N)-Player N" is a specific, Forge-generated token that can't
// plausibly collide with anything else in a real game log.
//
// Usage: tsx src/cli/relabel-generic-players.ts [--dry-run]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { RUNS_DIR, writeRunSummary } from "../analyze/runAndAnalyzePod.js";
import type { RunSummary } from "../analyze/types.js";

const GENERIC_TOKEN = /Ai\((\d+)\)-Player \d+/g;

function relabel(run: RunSummary): { run: RunSummary; renames: [string, string][] } | null {
  const text = JSON.stringify(run);
  const renames = new Map<string, string>();

  for (const match of text.matchAll(GENERIC_TOKEN)) {
    const [oldName, indexStr] = match;
    const index = Number(indexStr) - 1;
    const newName = run.playerNames[index];
    if (newName && newName !== oldName && !renames.has(oldName)) {
      renames.set(oldName, newName);
    }
  }

  if (renames.size === 0) return null;

  let fixedText = text;
  for (const [oldName, newName] of renames) {
    fixedText = fixedText.split(JSON.stringify(oldName).slice(1, -1)).join(JSON.stringify(newName).slice(1, -1));
  }

  return { run: JSON.parse(fixedText), renames: [...renames] };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));

  let touchedRuns = 0;
  let touchedNames = 0;

  for (const file of files) {
    const original: RunSummary = JSON.parse(readFileSync(path.join(RUNS_DIR, file), "utf-8"));
    const result = relabel(original);
    if (!result) continue;

    touchedRuns++;
    touchedNames += result.renames.length;
    for (const [oldName, newName] of result.renames) {
      console.log(`${file}: "${oldName}" -> "${newName}" (throughout - rawLog, analyticsEvents, everything)`);
    }
    if (!dryRun) writeRunSummary(result.run);
  }

  console.log(`\n${dryRun ? "[dry run] would relabel" : "Relabeled"} ${touchedNames} player(s) across ${touchedRuns} run(s).`);
}

main();
