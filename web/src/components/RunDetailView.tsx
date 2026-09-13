import { useEffect, useState } from "react";
import { api } from "../api";
import type { RunDetail } from "../types";
import { StatusBadge, WinRateBar, shortName } from "./RunList";

const POLL_MS = 4000;

export function RunDetailView({
  runId,
  onSelectGame,
  onBack,
}: {
  runId: string;
  onSelectGame: (gameIndex: number) => void;
  onBack: () => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setRun(null);

    async function poll() {
      try {
        const result = await api.getRun(runId);
        if (cancelled) return;
        setRun(result);
        setError(null);
        // Keep polling while the run is still in progress; the batch is
        // analyzed as a whole, so the games table appears all at once when
        // status flips to "complete" rather than filling in game-by-game.
        if (result.status === "running") timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (error)
    return (
      <p className="error">
        Couldn't load run {runId}: {error}
      </p>
    );
  if (!run) return <p className="muted">Loading...</p>;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        &larr; All runs
      </button>
      <h2>
        {run.runId} <StatusBadge status={run.status} error={run.error} />
      </h2>
      <p className="muted">
        {run.completedGames}/{run.requestedGames} games completed &middot;{" "}
        {new Date(run.createdAt).toLocaleString()}
      </p>

      {run.status === "running" && (
        <p className="muted">
          Simulating... this can take a while for a full batch. This page updates automatically, or come back
          later.
        </p>
      )}
      {run.status === "failed" && <p className="error">Run failed: {run.error}</p>}

      {run.games.length > 0 && (
        <>
          <h3>Aggregate results</h3>
          <WinRateBar winsByPlayer={run.winsByPlayer} totalGames={run.completedGames} />

          <h3>Games</h3>
          <table className="run-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Result</th>
                <th>Duration</th>
                <th>Turning points</th>
              </tr>
            </thead>
            <tbody>
              {run.games.map((game) => (
                <tr key={game.gameIndex} onClick={() => onSelectGame(game.gameIndex)} className="clickable-row">
                  <td>{game.gameIndex}</td>
                  <td>{game.isDraw ? "Draw" : shortName(game.winnerName ?? "?")} won</td>
                  <td>{(game.durationMs / 1000).toFixed(1)}s</td>
                  <td>{game.turningPointCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
