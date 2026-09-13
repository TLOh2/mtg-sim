#!/usr/bin/env node
// Used by scripts/phase1-smoke-test.sh: converts the checked-in fixture deck
// to .dck and writes it to the path given as argv[2], so the smoke test can
// feed real converter output into a real Forge game without needing live
// network access to Moxfield.
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeMoxfieldDeck, type MoxfieldRawDeck } from "../importers/moxfield.js";
import { toDck } from "../convert/dck.js";

const [, , outPath] = process.argv;
if (!outPath) {
  console.error("Usage: generate-fixture-dck <output-path.dck>");
  process.exit(1);
}

const fixture: MoxfieldRawDeck = JSON.parse(
  readFileSync(new URL("../../fixtures/moxfield-commander-sample.json", import.meta.url), "utf-8"),
);
const deck = normalizeMoxfieldDeck(fixture, "https://www.moxfield.com/decks/fixture-deck-1");
writeFileSync(outPath, toDck(deck), "utf-8");
