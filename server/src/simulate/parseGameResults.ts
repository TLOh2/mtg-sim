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

/**
 * clockSeconds, when given, corrects a real bug in Forge's own timeout
 * handling (SimulateMatch.java's runWithTimeout wraps the game loop in a
 * cancelled-on-timeout background thread) - confirmed with real data, not
 * guessed: every game in a real run whose durationMs landed at-or-past the
 * clock was reported as a *win*, always for the same seat (seat 1), never
 * as the draw SimulateMatch.java's own code clearly intends
 * (`g1.setGameOver(GameEndReason.Draw)` in its finally block, with a
 * "Stopping slow match as draw" log line). Root cause: `future.cancel(true)`
 * only *requests* interruption - Forge's game loop doesn't check for it at
 * fine enough granularity, so the background thread keeps mutating the
 * shared Game object after the timeout fires, racing the main thread's
 * forced draw and usually winning that race with a stale/partial outcome
 * (the same seat every time, not a real winner - the captured log even
 * showed every player logged as "has won because all opponents have lost"
 * simultaneously, a state that never occurs in a real elimination). Rather
 * than patch Forge's internal game-loop cancellation (a vendored,
 * unfamiliar codebase - see engine/NOTES.md's vendoring philosophy), a
 * duration that reached or exceeded the wall-clock budget is an
 * unambiguous signal on its own: a natural finish always returns strictly
 * before the timer fires, so this can never misclassify a real win.
 */
export function parseGameResults(rawStdout: string, clockSeconds?: number): GameResult[] {
  const lines = rawStdout.split("\n");
  const games: GameResult[] = [];
  let segmentStart = 0;
  const timedOut = (durationMs: number) => clockSeconds !== undefined && durationMs >= clockSeconds * 1000;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const winMatch = line.match(WIN_LINE);
    const drawMatch = line.match(DRAW_LINE);
    if (!winMatch && !drawMatch) continue;

    const rawLog = lines.slice(segmentStart, i + 1).join("\n");
    if (winMatch) {
      const durationMs = Number(winMatch[2]);
      games.push({
        gameIndex: Number(winMatch[1]),
        winnerName: timedOut(durationMs) ? null : winMatch[3],
        isDraw: timedOut(durationMs),
        durationMs,
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
