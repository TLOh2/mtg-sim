import type { EventType, GameEvent } from "./types.js";

// Caption strings match forge-game's GameLogEntryType.getCaption() exactly
// (see engine/forge/forge-game/src/main/java/forge/game/GameLogEntryType.java)
// - each GameLogEntry prints as "<caption>: <message>". Classifying against
// this authoritative list rather than re-guessing categories from arbitrary
// prefix strings, per spec.json#log_parsing's own note.
const CAPTION_TO_TYPE: Array<[string, EventType]> = [
  ["Game Outcome", "GAME_OUTCOME"],
  ["Match Result", "MATCH_RESULTS"],
  ["Turn", "TURN"],
  ["Mulligan", "MULLIGAN"],
  ["Ante", "ANTE"],
  ["Draft", "DRAFT"],
  ["Zone Change", "ZONE_CHANGE"],
  ["Player Control", "PLAYER_CONTROL"],
  ["Damage", "DAMAGE"],
  ["Life", "LIFE"],
  ["Land", "LAND"],
  ["Discard", "DISCARD"],
  ["Combat", "COMBAT"],
  ["Information", "INFORMATION"],
  ["Resolve Stack", "STACK_RESOLVE"],
  ["Add To Stack", "STACK_ADD"],
  ["Replacement Effect", "EFFECT_REPLACED"],
  ["Mana", "MANA"],
  ["Phase", "PHASE"],
];

const TURN_NUMBER = /Turn (\d+)/;

function classify(line: string): EventType {
  for (const [caption, type] of CAPTION_TO_TYPE) {
    if (line.startsWith(caption + ": ")) return type;
  }
  return "UNCLASSIFIED";
}

/**
 * Parses one game's raw Forge log (as produced by parseGameResults, or
 * Forge's stdout directly) into a structured event timeline.
 *
 * `playerNames` should be the exact player name strings Forge assigned
 * (`Ai(<index+1>)-<deck metadata Name>`, in deck order - see
 * SimulateMatch.java) - matching by exact substring is far more reliable
 * than trying to regex a player name out of free text, since deck names
 * themselves can contain almost anything.
 */
export function parseGameLog(rawLog: string, playerNames: string[]): GameEvent[] {
  const lines = rawLog.split("\n");
  const events: GameEvent[] = [];
  let currentTurn = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;

    const type = classify(trimmed);
    if (type === "TURN") {
      const match = trimmed.match(TURN_NUMBER);
      if (match) currentTurn = Number(match[1]);
    }

    const playersInvolved = playerNames.filter((name) => trimmed.includes(name));

    events.push({ turn: currentTurn, index, type, raw: trimmed, playersInvolved });
  });

  return events;
}
