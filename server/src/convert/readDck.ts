import { readFileSync } from "node:fs";

// Reads just enough out of a .dck file to drive the pipeline's later stages
// without re-deriving it from a NormalizedDeck: the deck's display Name
// (Forge uses this to build its player names - see SimulateMatch.java) and
// its commander card name(s) (for turningPoints.ts's commander_cast_or_recast
// detector). Deliberately not a full .dck parser - see spec.json#deck_format
// for the section layout this assumes.
export interface DckSummary {
  name: string;
  commanderNames: string[];
}

function stripCardLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // "<count> <name>|<set>|<cn>" or "<count> <name>"
  const match = trimmed.match(/^\d+\s+(.+?)(?:\|.*)?$/);
  return match ? match[1].trim() : null;
}

export function readDckSummary(dckPath: string): DckSummary {
  const content = readFileSync(dckPath, "utf-8");
  const lines = content.split(/\r?\n/);

  let name = dckPath;
  const commanderNames: string[] = [];
  let section: string | null = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section === "metadata" && line.startsWith("Name=")) {
      name = line.slice("Name=".length).trim();
    } else if (section === "Commander") {
      const cardName = stripCardLine(line);
      if (cardName) commanderNames.push(cardName);
    }
  }

  return { name, commanderNames };
}

/** Mirrors how Forge names AI players in sim mode: "Ai(<1-based index>)-<deck name>". */
export function buildPlayerRoster(dckPaths: string[]): {
  playerNames: string[];
  commandersByPlayer: Record<string, string[]>;
} {
  const playerNames: string[] = [];
  const commandersByPlayer: Record<string, string[]> = {};

  dckPaths.forEach((dckPath, i) => {
    const { name, commanderNames } = readDckSummary(dckPath);
    const playerName = `Ai(${i + 1})-${name}`;
    playerNames.push(playerName);
    commandersByPlayer[playerName] = commanderNames;
  });

  return { playerNames, commandersByPlayer };
}
