// Mirrors server/src/analyze/types.ts and server/src/parse/types.ts - kept
// as a hand-copied subset rather than a shared package, since web/ and
// server/ are separate npm packages and this is a small, low-churn surface.

export type RunStatus = "running" | "complete" | "failed" | "cancelled";

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
  deckSelections?: DeckSelection[];
  deckPaths: string[];
  clockSeconds?: number;
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

export interface AnalyticsEvent {
  type: string;
  [field: string]: unknown;
}

export interface GameDetail {
  gameIndex: number;
  winnerName: string | null;
  isDraw: boolean;
  durationMs: number;
  events: GameEvent[];
  turningPoints: TurningPoint[];
  rawLog: string;
  analyticsEvents: AnalyticsEvent[];
}

export interface LifePoint {
  turn: number;
  life: number;
}

export interface PlayerGameStats {
  player: string;
  mulligans: number;
  landsPlayed: number;
  spellsCast: number;
  actionsTotal: number;
  firstSpellCastTurn: number | null;
  commanderCastTurns: number[];
  combatDamageTaken: number;
  nonCombatDamageTaken: number;
  lifeCurve: LifePoint[];
  eliminatedTurn: number | null;
  finalLife: number | null;
}

export interface GameStats {
  gameIndex: number;
  turnsPlayed: number;
  firstCombatDamageTurn: number | null;
  players: PlayerGameStats[];
}

export interface DeckAggregateStats {
  player: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgMulligans: number;
  avgLandsPlayed: number;
  avgSpellsCast: number;
  avgFirstSpellCastTurn: number | null;
  avgCommanderCastTurn: number | null;
  avgEliminatedTurnWhenLost: number | null;
  manaIssueFlag: boolean;
  powerBracketEstimate: number;
}

export interface CardCastCount {
  card: string;
  count: number;
}

export interface RunStats {
  games: GameStats[];
  aggregate: DeckAggregateStats[];
  cardCastCounts: Record<string, CardCastCount[]>;
}
