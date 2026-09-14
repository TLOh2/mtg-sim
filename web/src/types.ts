// Mirrors server/src/analyze/types.ts and server/src/parse/types.ts - kept
// as a hand-copied subset rather than a shared package, since web/ and
// server/ are separate npm packages and this is a small, low-churn surface.

export type RunStatus = "running" | "complete" | "failed";

export interface RunListEntry {
  runId: string;
  createdAt: string;
  status: RunStatus;
  error?: string;
  playerNames: string[];
  requestedGames: number;
  completedGames: number;
  winsByPlayer: Record<string, number>;
}

export interface GameSummary {
  gameIndex: number;
  winnerName: string | null;
  isDraw: boolean;
  durationMs: number;
  turningPointCount: number;
}

export interface RunDetail extends RunListEntry {
  deckUrls?: string[];
  deckPaths: string[];
  games: GameSummary[];
}

export interface StartRunResponse {
  runId: string;
  status: RunStatus;
}

export interface DeckLibraryEntry {
  id: string;
  label: string;
  decklistText: string;
  commanderPreview?: string;
  savedAt: string;
}

export type DeckSelection = { deckId: string } | { label: string; decklistText: string };

export interface GameEvent {
  turn: number;
  index: number;
  type: string;
  raw: string;
  playersInvolved: string[];
}

export interface TurningPoint {
  signalId: string;
  eventIndex: number;
  description: string;
}

export interface GameDetail {
  gameIndex: number;
  winnerName: string | null;
  isDraw: boolean;
  durationMs: number;
  events: GameEvent[];
  turningPoints: TurningPoint[];
  rawLog: string;
}
