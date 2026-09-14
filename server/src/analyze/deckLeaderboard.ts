import { computeGameStats, computeRunAggregateStats } from "./gameStats.js";
import type { RunSummary } from "./types.js";

// Cross-run aggregation (spec.json's "analytics pass over N games of the
// same deck matchup" - Section 3) - everything else in gameStats.ts is
// scoped to one run at a time. This answers "how has this deck actually
// performed across every run it's been in," not just the one you're looking
// at right now.

export interface DeckRunHistoryPoint {
  runId: string;
  createdAt: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  bracketEstimate: number;
}

export interface DeckLeaderboardEntry {
  /** Currently just the label, normalized - see computeDeckLeaderboard's doc comment for why. */
  deckKey: string;
  label: string;
  runsPlayed: number;
  totalGamesPlayed: number;
  totalWins: number;
  overallWinRate: number;
  /** Average of each run's own rough bracket estimate - see gameStats.ts's powerBracketEstimate caveats, which all apply here too. */
  avgBracketEstimate: number;
  /**
   * Spread of this deck's per-run win rate (population standard deviation,
   * in the same 0-1 units as winRate) - a "swinginess" signal distinct from
   * overallWinRate itself: two decks can share the same overall win rate
   * while one hovers near it every run and the other swings between
   * dominating and whiffing. Null with fewer than 2 runs (spread is
   * undefined for a single data point).
   */
  winRateStdDev: number | null;
  /** Chronological, oldest first - the raw material for a "dominance over time" chart. */
  history: DeckRunHistoryPoint[];
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Population standard deviation - describing the spread of the runs actually observed, not estimating a wider population from a sample. */
function stdDev(nums: number[]): number {
  if (nums.length === 0) return 0;
  const mean = avg(nums);
  return Math.sqrt(avg(nums.map((n) => (n - mean) ** 2)));
}

/**
 * Only "complete" runs count - a failed or cancelled run has no real result
 * to attribute to a deck, and "running" ones aren't finished yet.
 *
 * A deck is identified by its display label, normalized (trimmed, casefolded
 * for comparison). Originally this preferred the saved deckId when a run
 * recorded one (see RunSummary.deckSelections), falling back to the label
 * for older runs that predate that field - but that meant the *same* deck
 * split into two separate leaderboard rows the moment it appeared in one run
 * with a deckId and another without one (confirmed: real bug, not a
 * hypothetical - Pantlaza Dinosaurs showed up twice). deckId is only
 * populated some of the time and two runs of literally the same deck can
 * easily land on either side of that split, so it isn't actually a reliable
 * join key in practice - the label is what's consistently present and is
 * also what a person means by "the same deck." A user naming two genuinely
 * different decks identically would merge them here, but that's a much
 * rarer and more avoidable collision than the one this fixes.
 */
export function computeDeckLeaderboard(runs: RunSummary[]): DeckLeaderboardEntry[] {
  const byDeck = new Map<string, { label: string; history: DeckRunHistoryPoint[] }>();

  for (const run of runs) {
    if (run.status !== "complete" || run.games.length === 0) continue;

    const gameStatsList = run.games.map((g) =>
      computeGameStats(g.gameIndex, g.analyticsEvents ?? [], run.playerNames, run.commandersByPlayer ?? {}),
    );
    const gameStatsByIndex = new Map(gameStatsList.map((g) => [g.gameIndex, g]));
    const aggregate = computeRunAggregateStats(run.games, gameStatsByIndex, run.playerNames);

    run.playerNames.forEach((player, i) => {
      const a = aggregate.find((x) => x.player === player);
      if (!a) return;

      const label = (run.deckUrls?.[i] ?? player).trim();
      const deckKey = label.toLowerCase();

      if (!byDeck.has(deckKey)) byDeck.set(deckKey, { label, history: [] });
      byDeck.get(deckKey)!.history.push({
        runId: run.runId,
        createdAt: run.createdAt,
        gamesPlayed: a.gamesPlayed,
        wins: a.wins,
        winRate: a.winRate,
        bracketEstimate: a.powerBracketEstimate,
      });
    });
  }

  const results: DeckLeaderboardEntry[] = [];
  for (const [deckKey, { label, history }] of byDeck) {
    history.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const totalGamesPlayed = history.reduce((s, h) => s + h.gamesPlayed, 0);
    const totalWins = history.reduce((s, h) => s + h.wins, 0);
    results.push({
      deckKey,
      label,
      runsPlayed: history.length,
      totalGamesPlayed,
      totalWins,
      overallWinRate: totalGamesPlayed > 0 ? totalWins / totalGamesPlayed : 0,
      avgBracketEstimate: avg(history.map((h) => h.bracketEstimate)),
      winRateStdDev: history.length >= 2 ? stdDev(history.map((h) => h.winRate)) : null,
      history,
    });
  }

  results.sort((a, b) => b.overallWinRate - a.overallWinRate);
  return results;
}

export interface GameDurationStats {
  sampleSize: number;
  /** avg(actual game duration / that run's clock setting) across every completed game with a known clock - a fraction rather than a raw duration, so it stays meaningful across runs that used different clockSeconds. Multiply by a prospective run's own games*clockSeconds to estimate how long it'll actually take. */
  avgFractionOfClock: number | null;
}

/**
 * How long games actually take relative to the clock they were given -
 * powers the "estimated time" shown before starting a new run (see
 * NewRunForm.tsx). games*clockSeconds alone is a worst-case ceiling (every
 * game timing out); this is closer to what typically happens.
 */
export function computeGameDurationStats(runs: RunSummary[]): GameDurationStats {
  const fractions: number[] = [];
  for (const run of runs) {
    if (run.status !== "complete" || !run.clockSeconds) continue;
    for (const g of run.games) {
      fractions.push(g.durationMs / 1000 / run.clockSeconds);
    }
  }
  return {
    sampleSize: fractions.length,
    avgFractionOfClock: fractions.length > 0 ? avg(fractions) : null,
  };
}
