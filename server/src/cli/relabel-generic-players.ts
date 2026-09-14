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
// Usage: tsx src/cli/relabel-generic-players.ts [--dry-run]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { RUNS_DIR, writeRunSummary } from "../analyze/runAndAnalyzePod.js";
import type { RunSummary } from "../analyze/types.js";

const GENERIC_NAME = /^(Ai\(\d+\)-)Player \d+$/;

function loadRun(file: string): RunSummary {
  return JSON.parse(readFileSync(path.join(RUNS_DIR, file), "utf-8"));
}

function relabel(run: RunSummary): { run: RunSummary; renames: [string, string][] } {
  const renames: [string, string][] = [];

  for (const oldName of run.playerNames) {
    const match = oldName.match(GENERIC_NAME);
    if (!match) continue;
    const commanders = run.commandersByPlayer?.[oldName];
    if (!commanders || commanders.length === 0) continue;
    const newName = `${match[1]}${commanders.join(" + ")}`;
    if (newName !== oldName) renames.push([oldName, newName]);
  }

  if (renames.length === 0) return { run, renames };

  const renameMap = new Map(renames);
  const renameKey = (k: string) => renameMap.get(k) ?? k;

  const relabeled: RunSummary = {
    ...run,
    playerNames: run.playerNames.map(renameKey),
    deckUrls: run.deckUrls?.map((u, i) => (GENERIC_NAME.test(run.playerNames[i]) ? renameKey(run.playerNames[i]).replace(/^Ai\(\d+\)-/, "") : u)),
    commandersByPlayer: run.commandersByPlayer
      ? Object.fromEntries(Object.entries(run.commandersByPlayer).map(([k, v]) => [renameKey(k), v]))
      : run.commandersByPlayer,
    winsByPlayer: Object.fromEntries(Object.entries(run.winsByPlayer).map(([k, v]) => [renameKey(k), v])),
    games: run.games.map((g) => ({
      ...g,
      winnerName: g.winnerName ? renameKey(g.winnerName) : g.winnerName,
    })),
  };

  return { run: relabeled, renames };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));

  let touchedRuns = 0;
  let touchedNames = 0;

  for (const file of files) {
    const original = loadRun(file);
    const { run: relabeled, renames } = relabel(original);
    if (renames.length === 0) continue;

    touchedRuns++;
    touchedNames += renames.length;
    for (const [oldName, newName] of renames) {
      console.log(`${file}: "${oldName}" -> "${newName}"`);
    }
    if (!dryRun) writeRunSummary(relabeled);
  }

  console.log(`\n${dryRun ? "[dry run] would relabel" : "Relabeled"} ${touchedNames} player(s) across ${touchedRuns} run(s).`);
}

main();
