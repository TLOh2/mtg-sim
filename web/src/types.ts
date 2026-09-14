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

export interface TurnSnapshot {
  turn: number;
  handSize: number;
  landsInHand: number;
  landsInPlay: number;
  untappedLands: number;
  untappedManaSources: number;
}

export interface ManaThresholdTurns {
  five: number | null;
  seven: number | null;
  ten: number | null;
}

export interface PlayerGameStats {
  player: string;
  mulligans: number;
  landsPlayed: number;
  spellsCast: number;
  actionsTotal: number;
  firstSpellCastTurn: number | null;
  commanderCastTurns: number[];
  firstCommanderCastTurn: number | null;
  combatDamageTaken: number;
  nonCombatDamageTaken: number;
  combatDamageDealt: number;
  nonCombatDamageDealt: number;
  commanderDamageDealt: number;
  nonDamageLifeLossDealt: number;
  firstCombatDamageDealtTurn: number | null;
  lifeCurve: LifePoint[];
  eliminatedTurn: number | null;
  finalLife: number | null;
  turnSnapshots: TurnSnapshot[];
  missedLandDropTurns: number[];
  manaThresholdTurns: ManaThresholdTurns;
  avgManaEfficiency: number | null;
  avgCurveEfficiency: number | null;
}

export interface EliminationEvent {
  player: string;
  turn: number;
}

export interface GameStats {
  gameIndex: number;
  turnsPlayed: number;
  firstCombatDamageTurn: number | null;
  eliminationOrder: EliminationEvent[];
  threatMatrix: Record<string, Record<string, number>>;
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
  avgCombatDamageDealt: number;
  avgNonCombatDamageDealt: number;
  avgCommanderDamageDealt: number;
  avgNonDamageLifeLossDealt: number;
  avgFirstCombatDamageDealtTurn: number | null;
  avgWinningGameTurn: number | null;
  avgFinishPosition: number | null;
  avgMissedLandDrops: number;
  avgLandsInHandAtEnd: number;
  avgManaThresholdTurns: ManaThresholdTurns;
  avgManaEfficiency: number | null;
  avgCurveEfficiency: number | null;
  manaIssueFlag: boolean;
  powerBracketEstimate: number;
}

export interface CardCastCount {
  card: string;
  count: number;
}

export interface SpellsByRoundPoint {
  round: number;
  count: number;
}

export interface DeckRunHistoryPoint {
  runId: string;
  createdAt: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  bracketEstimate: number;
}

export interface GameDurationStats {
  sampleSize: number;
  avgFractionOfClock: number | null;
}

export interface DeckLeaderboardEntry {
  deckKey: string;
  label: string;
  runsPlayed: number;
  totalGamesPlayed: number;
  totalWins: number;
  overallWinRate: number;
  avgBracketEstimate: number;
  winRateStdDev: number | null;
  history: DeckRunHistoryPoint[];
}

export interface RunStats {
  games: GameStats[];
  aggregate: DeckAggregateStats[];
  cardCastCounts: Record<string, CardCastCount[]>;
  threatMatrix: Record<string, Record<string, number>>;
  spellsByRound: SpellsByRoundPoint[];
  /** Same tempo data, broken out per player - average (not summed) spells cast per round. */
  spellsByRoundPerPlayer: Record<string, SpellsByRoundPoint[]>;
  /** Nonland cards in a player's actual decklist that never got cast this run - empty for runs this can't be computed for (see neverCast.ts). */
  neverCast: Record<string, string[]>;
  awards: Award[];
}

export interface Award {
  id: string;
  title: string;
  description: string;
  player: string;
  value: string;
}
