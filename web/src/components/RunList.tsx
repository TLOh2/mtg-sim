import { useEffect, useState } from "react";
import { api } from "../api";
import type { RunListEntry } from "../types";
import { NewRunForm } from "./NewRunForm";

const POLL_MS = 4000;

export function RunList({ onSelectRun }: { onSelectRun: (runId: string) => void }) {
  const [runs, setRuns] = useState<RunListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const result = await api.listRuns();
        if (cancelled) return;
        setRuns(result);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div>
      <div className="list-header">
        <h3 className="section-title">Runs</h3>
        {!showForm && <button onClick={() => setShowForm(true)}>+ New run</button>}
      </div>

      {showForm && (
        <NewRunForm
          onStarted={(runId) => {
            setShowForm(false);
            onSelectRun(runId);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <p className="error">Couldn't load runs: {error}</p>}
      {!runs && !error && <p className="muted">Loading runs...</p>}
      {runs && runs.length === 0 && (
        <p className="muted">No simulation runs yet. Start one above, or via `npm run analyze:pod` in `server/`.</p>
      )}
      {runs && runs.length > 0 && (
        <table className="run-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Created</th>
              <th>Status</th>
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
                  <StatusBadge status={run.status} error={run.error} />
                </td>
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
      )}
    </div>
  );
}

export function StatusBadge({ status, error }: { status: RunListEntry["status"]; error?: string }) {
  if (status === "running") return <span className="status-badge status-running">running…</span>;
  if (status === "failed")
    return (
      <span className="status-badge status-failed" title={error}>
        failed
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="status-badge status-cancelled" title={error}>
        cancelled
      </span>
    );
  return <span className="status-badge status-complete">complete</span>;
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
