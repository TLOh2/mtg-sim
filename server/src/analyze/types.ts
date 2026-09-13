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

// "running" is written immediately when a run starts (before Forge has
// produced any results) so the dashboard can show it in the list right away
// and poll until it flips to "complete" or "failed" - a batch of 20 games
// can take a long time, so the UI needs something to show in the meantime.
export type RunStatus = "running" | "complete" | "failed";

export interface RunSummary {
  runId: string;
  createdAt: string;
  status: RunStatus;
  /** Present only when status is "failed". */
  error?: string;
  /** Present when the run was started from Moxfield URLs via the dashboard, rather than raw .dck paths via the CLI. */
  deckUrls?: string[];
  deckPaths: string[];
  playerNames: string[];
  requestedGames: number;
  completedGames: number;
  /** Wins per player name, including a "Draw" bucket - the dashboard's aggregate view. */
  winsByPlayer: Record<string, number>;
  games: AnalyzedGame[];
}
