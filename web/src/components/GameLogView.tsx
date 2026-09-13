import { useEffect, useState } from "react";
import { api } from "../api";
import type { GameDetail } from "../types";
import { shortName } from "./RunList";

export function GameLogView({
  runId,
  gameIndex,
  onBack,
}: {
  runId: string;
  gameIndex: number;
  onBack: () => void;
}) {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGame(null);
    api.getGame(runId, gameIndex).then(setGame).catch((err) => setError(String(err.message ?? err)));
  }, [runId, gameIndex]);

  if (error) return <p className="error">Couldn't load game {gameIndex}: {error}</p>;
  if (!game) return <p className="muted">Loading...</p>;

  const turningPointByEventIndex = new Map(game.turningPoints.map((tp) => [tp.eventIndex, tp]));

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        &larr; Back to run
      </button>
      <h2>
        Game {game.gameIndex}: {game.isDraw ? "Draw" : `${shortName(game.winnerName ?? "?")} won`}
      </h2>
      <p className="muted">
        {(game.durationMs / 1000).toFixed(1)}s &middot; {game.turningPoints.length} turning point(s) flagged
      </p>

      <div className="log-timeline">
        {game.events.map((event) => {
          const tp = turningPointByEventIndex.get(event.index);
          return (
            <div key={event.index} className={`log-line log-type-${event.type.toLowerCase()}${tp ? " turning-point" : ""}`}>
              <span className="log-turn">T{event.turn}</span>
              <span className="log-raw">{event.raw}</span>
              {tp && <span className="turning-point-badge">{tp.signalId}: {tp.description}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
