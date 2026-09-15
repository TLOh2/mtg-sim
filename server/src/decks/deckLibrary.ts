import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseMoxfieldTextExport } from "../importers/moxfieldText.js";
import type { DeckLibraryEntry } from "./types.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

// Baked-in decks: committed to the repo, so they survive every redeploy for
// free, no persistent disk needed.
const PRESET_DECKS_DIR = path.join(REPO_ROOT, "server", "presets", "decks");

// Decks pasted through the dashboard (by you or a friend) get auto-saved
// here so they don't need to be re-pasted next time. NOT committed to git -
// this lives only as long as the current deploy does (same as data/runs/).
// You chose not to add a persistent disk yet, so this is a known, accepted
// tradeoff: convenient between deploys, wiped on the next one. See
// PROGRESS.md.
export const SAVED_DECKS_DIR = path.join(REPO_ROOT, "data", "decks");

function commanderPreview(decklistText: string): string | undefined {
  try {
    return parseMoxfieldTextExport(decklistText, "preview").commander.map((c) => c.name).join(" + ");
  } catch {
    // Unparseable text shouldn't block saving it - just no preview to show.
    return undefined;
  }
}

/** Fills in commanderPreview for a hand-written preset file that omitted it, so writing one by hand doesn't require running the parser yourself first. */
function withPreview(entry: DeckLibraryEntry): DeckLibraryEntry {
  return entry.commanderPreview ? entry : { ...entry, commanderPreview: commanderPreview(entry.decklistText) };
}

function readDir(dir: string): DeckLibraryEntry[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => withPreview(JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as DeckLibraryEntry));
  } catch {
    return [];
  }
}

export function listDecks(): DeckLibraryEntry[] {
  const all = [...readDir(PRESET_DECKS_DIR), ...readDir(SAVED_DECKS_DIR)];
  all.sort((a, b) => a.label.localeCompare(b.label));
  return all;
}

export function getDeck(id: string): DeckLibraryEntry | null {
  for (const dir of [PRESET_DECKS_DIR, SAVED_DECKS_DIR]) {
    try {
      return withPreview(JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf-8")) as DeckLibraryEntry);
    } catch {
      // Not in this directory - try the next one.
    }
  }
  return null;
}

/**
 * Reuses an existing saved entry with the exact same decklist text (leading/trailing
 * whitespace aside) instead of creating a duplicate - pasting "the same" deck across
 * two different sessions used to leave two separate library entries behind. Only
 * checks SAVED_DECKS_DIR (not presets - a paste matching a preset is still worth
 * saving as its own entry, since presets aren't necessarily meant to be the same
 * as what someone actually plays).
 */
function findExistingByText(decklistText: string): DeckLibraryEntry | null {
  const normalized = decklistText.trim();
  for (const entry of readDir(SAVED_DECKS_DIR)) {
    if (entry.decklistText.trim() === normalized) return entry;
  }
  return null;
}

const GENERIC_LABEL = /^Player \d+$/;

export function saveDeck(label: string, decklistText: string): DeckLibraryEntry {
  const existing = findExistingByText(decklistText);
  if (existing) {
    // The earlier paste may only have had a generic "Player N" label (no commander
    // name resolved yet, or nobody typed one in) - if this paste has a real one,
    // upgrade the saved entry instead of leaving it stuck with the confusing name.
    if (GENERIC_LABEL.test(existing.label) && !GENERIC_LABEL.test(label)) {
      const upgraded = { ...existing, label };
      writeFileSync(path.join(SAVED_DECKS_DIR, `${existing.id}.json`), JSON.stringify(upgraded, null, 2), "utf-8");
      return upgraded;
    }
    return existing;
  }

  const entry: DeckLibraryEntry = {
    id: randomUUID(),
    label,
    decklistText,
    commanderPreview: commanderPreview(decklistText),
    savedAt: new Date().toISOString(),
  };
  mkdirSync(SAVED_DECKS_DIR, { recursive: true });
  writeFileSync(path.join(SAVED_DECKS_DIR, `${entry.id}.json`), JSON.stringify(entry, null, 2), "utf-8");
  return entry;
}
