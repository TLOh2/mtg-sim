import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import type { DeckLeaderboardEntry } from "../types";
import { shortName } from "./RunList";
import { LineChart } from "./Charts";

export function DeckLeaderboardView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<DeckLeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDeckLeaderboard()
      .then(setEntries)
      .catch((err) => setError(String((err as Error).message ?? err)));
  }, []);

  if (error) return <p className="error">Couldn't load the deck leaderboard: {error}</p>;
  if (!entries) return <p className="muted">Loading...</p>;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        &larr; All runs
      </button>
      <h2>Deck leaderboard</h2>
      <p className="stats-caveat">
        Every deck's record across all completed runs, not just one - the running tally of who's actually
        dominant. Sorted by overall win rate. A deck that's only ever appeared in one run doesn't yet have
        enough data to say much - keep an eye on runsPlayed. Bracket estimate is the same rough, directional
        heuristic as on a single run's page, averaged across its runs here. "Swing" is how much this deck's
        win rate varies run to run (±, in percentage points) - two decks can share the same overall win rate
        while one hovers near it every time and the other alternates between dominating and whiffing; needs
        2+ runs to mean anything.
      </p>

      {entries.length === 0 && (
        <p className="muted">No completed runs yet - finish a run to start building deck history.</p>
      )}

      {entries.length > 0 && (
        <table className="run-table">
          <thead>
            <tr>
              <th>Deck</th>
              <th>Runs</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Win rate</th>
              <th title="How much this deck's win rate varies run to run - see the note above.">Swing</th>
              <th>Avg. bracket</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <Fragment key={e.deckKey}>
                <tr
                  className="clickable-row"
                  onClick={() => setExpanded(expanded === e.deckKey ? null : e.deckKey)}
                >
                  <td>{shortName(e.label)}</td>
                  <td>{e.runsPlayed}</td>
                  <td>{e.totalGamesPlayed}</td>
                  <td>{e.totalWins}</td>
                  <td>{Math.round(e.overallWinRate * 100)}%</td>
                  <td>{e.winRateStdDev !== null ? `±${Math.round(e.winRateStdDev * 100)}pp` : "—"}</td>
                  <td>
                    <span className="bracket-pill">{e.avgBracketEstimate.toFixed(1)}</span>
                  </td>
                </tr>
                {expanded === e.deckKey && (
                  <tr>
                    <td colSpan={7}>
                      <DominanceOverTime entry={e} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DominanceOverTime({ entry }: { entry: DeckLeaderboardEntry }) {
  if (entry.history.length < 2) {
    return <p className="muted">Only one run so far - dominance-over-time needs at least two to chart a trend.</p>;
  }

  const winRateSeries = {
    label: "Win rate (%)",
    points: entry.history.map((h, i) => ({ x: i + 1, y: Math.round(h.winRate * 100) })),
  };
  const bracketSeries = {
    label: "Bracket estimate",
    color: "#e0a52a",
    points: entry.history.map((h, i) => ({ x: i + 1, y: h.bracketEstimate })),
  };

  return (
    <div>
      <p className="stats-caveat">
        Each point is one run, in order run ({entry.history.length} total) - hover a run's row above for exact
        dates.
      </p>
      <LineChart series={[winRateSeries]} yMin={0} xLabel="Run #" yLabel="Win rate %" />
      <LineChart series={[bracketSeries]} yMin={1} xLabel="Run #" yLabel="Bracket" />
      <table className="deck-stats-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Date</th>
            <th>Games</th>
            <th>Wins</th>
            <th>Bracket</th>
          </tr>
        </thead>
        <tbody>
          {entry.history.map((h) => (
            <tr key={h.runId}>
              <td>{h.runId}</td>
              <td>{new Date(h.createdAt).toLocaleDateString()}</td>
              <td>{h.gamesPlayed}</td>
              <td>{h.wins}</td>
              <td>{h.bracketEstimate.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
