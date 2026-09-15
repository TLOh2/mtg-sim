import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildCardTypesInvocation } from "../simulate/javaSim.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CACHE_PATH = path.join(REPO_ROOT, "data", "card-types-cache.json");

export type CardTypeResult = "land" | "nonland" | "?";

function loadCache(): Record<string, CardTypeResult> {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CardTypeResult>): void {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

/**
 * Runs Forge's headless `cardtypes` mode (-> CardTypeLookup.java) directly
 * (no shell involved - see javaSim.ts) once with every given name piped to
 * its stdin, and parses its "name\tland|nonland|?" stdout back into a map.
 */
function runLookup(names: string[]): Promise<Record<string, CardTypeResult>> {
  return new Promise((resolve, reject) => {
    const invocation = buildCardTypesInvocation();
    const child = spawn(invocation.javaExecutable, invocation.args, { cwd: invocation.cwd });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`cardtypes lookup exited with code ${code}:\n${stderr.slice(-2000)}`));
        return;
      }
      const result: Record<string, CardTypeResult> = {};
      for (const line of stdout.split("\n")) {
        const tab = line.lastIndexOf("\t");
        if (tab === -1) continue;
        const name = line.slice(0, tab);
        const type = line.slice(tab + 1).trim();
        if (type === "land" || type === "nonland" || type === "?") result[name] = type;
      }
      resolve(result);
    });

    child.stdin.end(names.join("\n") + "\n");
  });
}

/**
 * Resolves each of the given card names to "land"/"nonland" (or "?" if
 * Forge's card database doesn't recognize the name) via Forge's own data,
 * not a name-pattern guess - lands don't reliably contain the word "land"
 * (Command Tower, Blood Crypt, ...) and nonlands sometimes do (Beacon of
 * Tomorrows, Fields of the Dead-style silliness aside, that's a real risk
 * with a naive heuristic). Powers the "never cast" feature (see
 * server/src/analyze/neverCast.ts): excluding lands from a decklist diff
 * needs to actually know which cards are lands.
 *
 * Backed by a disk cache (data/card-types-cache.json), since spinning up
 * the JVM costs several seconds (FModel.initialize loads Forge's entire
 * card database) and that database is effectively static within a running
 * dashboard session - only names never looked up before pay that cost, and
 * only once, ever (across all runs, not per-run).
 */
export async function lookupCardTypes(names: string[]): Promise<Record<string, CardTypeResult>> {
  const cache = loadCache();
  const uncached = [...new Set(names)].filter((n) => !(n in cache));
  if (uncached.length === 0) return cache;

  const resolved = await runLookup(uncached);
  Object.assign(cache, resolved);
  saveCache(cache);
  return cache;
}
