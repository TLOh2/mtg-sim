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
