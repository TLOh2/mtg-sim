import { useEffect, useState } from "react";
import { api } from "../api";
import type { RunDetail } from "../types";
import { WinRateBar, shortName } from "./RunList";

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
    setRun(null);
    api.getRun(runId).then(setRun).catch((err) => setError(String(err.message ?? err)));
  }, [runId]);

  if (error) return <p className="error">Couldn't load run {runId}: {error}</p>;
  if (!run) return <p className="muted">Loading...</p>;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        &larr; All runs
      </button>
      <h2>{run.runId}</h2>
      <p className="muted">
        {run.completedGames}/{run.requestedGames} games completed &middot;{" "}
        {new Date(run.createdAt).toLocaleString()}
      </p>

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
    </div>
  );
}
