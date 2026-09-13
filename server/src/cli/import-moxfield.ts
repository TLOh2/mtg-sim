#!/usr/bin/env node
// CLI: fetch a real Moxfield deck by URL, normalize it, convert it to .dck,
// and write it to disk.
//
// Usage: npm run import:moxfield -- <moxfield-deck-url> [output-path.dck]
//
// NOTE: this session's network egress policy blocks moxfield.com entirely
// (see PROGRESS.md), so this has not been run against a real URL yet. It's
// written and unit-tested against a fixture (src/importers/moxfield.test.ts)
// to the extent possible without live access - running this for real, from
// an environment that can reach moxfield.com, is the actual Phase 1
// validation still outstanding.
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
