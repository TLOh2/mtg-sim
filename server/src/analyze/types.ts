import type { AnalyticsEvent, GameEvent, TurningPoint } from "../parse/types.js";
import type { DeckSelection } from "../decks/types.js";

export interface AnalyzedGame {
  gameIndex: number;
  winnerName: string | null;
  isDraw: boolean;
  durationMs: number;
  events: GameEvent[];
  turningPoints: TurningPoint[];
  rawLog: string;
  /** Structured events straight from Forge's event bus - see AnalyticsEvent. */
  analyticsEvents: AnalyticsEvent[];
}

// "running" is written immediately when a run starts (before Forge has
// produced any results) so the dashboard can show it in the list right away
// and poll until it flips to "complete" or "failed" - a batch of 20 games
// can take a long time, so the UI needs something to show in the meantime.
export type RunStatus = "running" | "complete" | "failed" | "cancelled";

export interface RunSummary {
  runId: string;
  createdAt: string;
  status: RunStatus;
  /** Present only when status is "failed" (or "cancelled", noting who/what stopped it). */
  error?: string;
  /** Present when the run was started from Moxfield URLs via the dashboard, rather than raw .dck paths via the CLI. */
  deckUrls?: string[];
  /** The resolved { deckId } selection for each player, in seat order - lets the dashboard offer "restart with same decks" without re-uploading anything. Undefined for older runs / CLI runs that predate this field. */
  deckSelections?: DeckSelection[];
  deckPaths: string[];
  playerNames: string[];
  /** playerName -> that player's commander card name(s); powers commander-cast stats and turning-point detection. Undefined for older runs. */
  commandersByPlayer?: Record<string, string[]>;
  requestedGames: number;
  /** The clock (see engine/run-sim.sh's -c) each game in this run was given, in seconds - persisted so "restart with same settings" can reuse it exactly. Undefined for older runs. */
  clockSeconds?: number;
  /** Per-seat Forge AI profile, same order as playerNames - see SimulateMatch.java's -a flag. Undefined (or all "Default") for the common case: every seat on Forge's own stock AI. */
  aiProfiles?: string[];
  completedGames: number;
  /** Wins per player name, including a "Draw" bucket - the dashboard's aggregate view. */
  winsByPlayer: Record<string, number>;
  games: AnalyzedGame[];
}
