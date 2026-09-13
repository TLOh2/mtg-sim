#!/usr/bin/env node
// CLI: fetch a real Moxfield deck by URL, normalize it, convert it to .dck,
// and write it to disk.
//
// Usage: npm run import:moxfield -- <moxfield-deck-url> [output-path.dck]
//
// The response shape this targets has been confirmed against a real live
// Moxfield deck (see PROGRESS.md's Phase 1 writeup) - this environment's own
// network egress still blocks moxfield.com directly, so running this CLI
// from here will fail to reach the API, but the code itself is validated.
import { importMoxfieldDeck } from "../importers/moxfield.js";
import { toDck } from "../convert/dck.js";
import { writeFileSync } from "node:fs";

async function main() {
  const [url, outPath] = process.argv.slice(2);
  if (!url) {
    console.error("Usage: import-moxfield <moxfield-deck-url> [output-path.dck]");
    process.exit(1);
  }

  const deck = await importMoxfieldDeck(url);
  const dck = toDck(deck);

  if (outPath) {
    writeFileSync(outPath, dck, "utf-8");
    console.error(`Wrote ${outPath}`);
  } else {
    console.log(dck);
  }
}

main().catch((err) => {
  console.error("Import failed:", err.message ?? err);
  process.exit(1);
});
