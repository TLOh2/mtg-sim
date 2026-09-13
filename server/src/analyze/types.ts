import type { GameEvent, TurningPoint } from "../parse/types.js";

export interface AnalyzedGame {
  gameIndex: number;
  winnerName: string | null;
  isDraw: boolean;
  durationMs: number;
  events: GameEvent[];
  turningPoints: TurningPoint[];
  rawLog: string;
}

export interface RunSummary {
  runId: string;
  createdAt: string;
  deckPaths: string[];
  playerNames: string[];
  requestedGames: number;
  completedGames: number;
  /** Wins per player name, including a "Draw" bucket - the dashboard's aggregate view. */
  winsByPlayer: Record<string, number>;
  games: AnalyzedGame[];
}
