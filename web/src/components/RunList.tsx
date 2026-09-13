import { useEffect, useState } from "react";
import { api } from "../api";
import type { RunListEntry } from "../types";

export function RunList({ onSelectRun }: { onSelectRun: (runId: string) => void }) {
  const [runs, setRuns] = useState<RunListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listRuns().then(setRuns).catch((err) => setError(String(err.message ?? err)));
  }, []);

  if (error) return <p className="error">Couldn't load runs: {error}</p>;
  if (!runs) return <p className="muted">Loading runs...</p>;
  if (runs.length === 0) {
    return (
      <p className="muted">
        No simulation runs yet. Run one via <code>npm run analyze:pod</code> in <code>server/</code>.
      </p>
    );
  }

  return (
    <table className="run-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Created</th>
          <th>Games</th>
          <th>Win rates</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runId} onClick={() => onSelectRun(run.runId)} className="clickable-row">
            <td>{run.runId}</td>
            <td>{new Date(run.createdAt).toLocaleString()}</td>
            <td>
              {run.completedGames}/{run.requestedGames}
            </td>
            <td>
              <WinRateBar winsByPlayer={run.winsByPlayer} totalGames={run.completedGames} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WinRateBar({
  winsByPlayer,
  totalGames,
}: {
  winsByPlayer: Record<string, number>;
  totalGames: number;
}) {
  if (totalGames === 0) return <span className="muted">no completed games</span>;
  const entries = Object.entries(winsByPlayer).filter(([, wins]) => wins > 0);
  return (
    <div className="win-rate-bar">
      {entries.map(([player, wins]) => (
        <span key={player} className="win-rate-chip" title={`${player}: ${wins}/${totalGames}`}>
          {shortName(player)} {Math.round((wins / totalGames) * 100)}%
        </span>
      ))}
    </div>
  );
}

export function shortName(fullPlayerName: string): string {
  // "Ai(1)-Starter Commander - Red" -> "Starter Commander - Red"
  return fullPlayerName.replace(/^Ai\(\d+\)-/, "");
}
