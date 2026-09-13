import type { GameResult } from "./types.js";

// Forge's SimulateMatch prints one synthesized summary line per game,
// distinct from the per-GameLogEntry lines above it (see engine/NOTES.md):
//   Game Result: Game 1 ended in 22457 ms. Ai(2)-Some Deck has won!
//   Game Result: Game 2 ended in 8551 ms. Ai(1)-Other Deck has won!
//   Game Result: Game 3 ended in 120000 ms. Game ended in a Draw!
// Each such line closes out one game's worth of preceding log lines. This
// splits Forge's raw stdout into per-game chunks using those lines as
// boundaries, without needing to understand the phase/turn structure inside
// each game yet - that deeper parse is Phase 3's job.
const WIN_LINE = /^Game Result: Game (\d+) ended in (\d+) ms\. (.+) has won!\s*$/;
const DRAW_LINE = /^Game Result: Game (\d+) ended in a Draw! Took (\d+) ms\.\s*$/;

export function parseGameResults(rawStdout: string): GameResult[] {
  const lines = rawStdout.split("\n");
  const games: GameResult[] = [];
  let segmentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const winMatch = line.match(WIN_LINE);
    const drawMatch = line.match(DRAW_LINE);
    if (!winMatch && !drawMatch) continue;

    const rawLog = lines.slice(segmentStart, i + 1).join("\n");
    if (winMatch) {
      games.push({
        gameIndex: Number(winMatch[1]),
        winnerName: winMatch[3],
        isDraw: false,
        durationMs: Number(winMatch[2]),
        rawLog,
      });
    } else if (drawMatch) {
      games.push({
        gameIndex: Number(drawMatch[1]),
        winnerName: null,
        isDraw: true,
        durationMs: Number(drawMatch[2]),
        rawLog,
      });
    }
    segmentStart = i + 1;
  }

  return games;
}
