import type { AnalyticsEvent } from "../parse/types.js";

// Mirrors spec.json#data_model.SimulationRun / GameResult, scoped down to
// what Phase 2 actually produces. Full event-list parsing + turning-point
// detection (GameEvent, TurningPoint) is Phase 3's job - this stage's
// "structured result" is just: who won, was it a draw, how long, and the
// full raw per-game log kept around for Phase 3 to parse later.

export interface BatchRunOptions {
  runId: string;
  games: number;
  format: string;
  clockSeconds: number;
  /** Called as each individual game finishes (not just once, at the very end) - see forgeRunner.ts's incremental stdout scan. Lets the caller persist real progress instead of the whole run reading 0/N until the entire batch completes. */
  onGameComplete?: (completedCount: number) => void;
  /** Per-player AI profile (Default/Cautious/Reckless/Experimental), same order as the deck paths - see SimulateMatch.java's `-a` flag. Omit an entry (or the whole array) to use Forge's own default for that seat. */
  aiProfiles?: string[];
  /** Per-player AI look-ahead simulation mode ("off"/"hybrid"/"full") - see SimulateMatch.java's `-sim` flag and forge-ai/simulation/GameSimulator.java. Omit for "off" (Forge's own default). */
  simModes?: string[];
}

export interface GameResult {
  gameIndex: number;
  winnerName: string | null;
  isDraw: boolean;
  durationMs: number;
  rawLog: string;
  /** Structured events from Forge's typed event bus - see AnalyticsEvent. Absent if the log file wasn't found/parseable (parseGameResults doesn't set this; forgeRunner attaches it after). */
  analyticsEvents?: AnalyticsEvent[];
}

export interface BatchRunResult {
  runId: string;
  deckPaths: string[];
  requestedGames: number;
  completedGames: number;
  games: GameResult[];
  rawStdout: string;
}
