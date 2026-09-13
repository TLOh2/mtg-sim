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
}

export interface BatchRunResult {
  runId: string;
  deckPaths: string[];
  requestedGames: number;
  completedGames: number;
  games: GameResult[];
  rawStdout: string;
}
