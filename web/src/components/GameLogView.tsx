import { useEffect, useState } from "react";
import { api } from "../api";
import type { GameDetail, GameStats } from "../types";
import { shortName } from "./RunList";
import { GameStoryView, formatStoryAsText } from "./GameStoryView";
import { LineChart } from "./Charts";

type Tab = "story" | "raw";

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
  const [stats, setStats] = useState<GameStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("story");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    setGame(null);
    setStats(null);
    api.getGame(runId, gameIndex).then(setGame).catch((err) => setError(String(err.message ?? err)));
    api
      .getStats(runId)
      .then((s) => setStats(s.games.find((g) => g.gameIndex === gameIndex) ?? null))
      .catch(() => setStats(null));
  }, [runId, gameIndex]);

  if (error) return <p className="error">Couldn't load game {gameIndex}: {error}</p>;
  if (!game) return <p className="muted">Loading...</p>;

  async function handleCopySummary() {
    if (!game) return;
    const players = stats?.players.map((p) => shortName(p.player)) ?? [];
    const header = [
      `Game ${game.gameIndex}: ${game.isDraw ? "Draw" : `${shortName(game.winnerName ?? "?")} won`}`,
      players.length > 0 ? `Players: ${players.join(" vs ")}` : null,
      `${(game.durationMs / 1000).toFixed(1)}s · ${game.turningPoints.length} turning point(s) flagged`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    const text = `${header}\n\n${formatStoryAsText(game.analyticsEvents ?? [])}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

  const turningPointByEventIndex = new Map(game.turningPoints.map((tp) => [tp.eventIndex, tp]));

  const lifeSeries =
    stats?.players
      .filter((p) => p.lifeCurve.length > 0)
      .map((p) => ({
        label: shortName(p.player),
        points: p.lifeCurve.map((pt) => ({ x: pt.turn, y: pt.life })),
      })) ?? [];

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        &larr; Back to run
      </button>
      <div className="run-header-actions">
        <h2>
          Game {game.gameIndex}: {game.isDraw ? "Draw" : `${shortName(game.winnerName ?? "?")} won`}
        </h2>
        <button type="button" className="secondary" onClick={handleCopySummary}>
          {copyState === "copied" ? "Copied!" : copyState === "error" ? "Couldn't copy" : "Copy game summary"}
        </button>
      </div>
      <p className="muted">
        {(game.durationMs / 1000).toFixed(1)}s &middot; {game.turningPoints.length} turning point(s) flagged
      </p>

      {lifeSeries.length > 0 && (
        <>
          <h3>Life totals</h3>
          <LineChart series={lifeSeries} yMin={0} xLabel="Turn" yLabel="Life" />
        </>
      )}

      <div className="story-toggle">
        <button type="button" className={tab === "story" ? "active" : "secondary"} onClick={() => setTab("story")}>
          Story
        </button>
        <button type="button" className={tab === "raw" ? "active" : "secondary"} onClick={() => setTab("raw")}>
          Raw log
        </button>
      </div>

      {tab === "story" && <GameStoryView events={game.analyticsEvents ?? []} />}

      {tab === "raw" && (
        <div className="log-timeline">
          {game.events.map((event) => {
            const tp = turningPointByEventIndex.get(event.index);
            return (
              <div
                key={event.index}
                className={`log-line log-type-${event.type.toLowerCase()}${tp ? " turning-point" : ""}`}
              >
                <span className="log-turn">T{event.turn}</span>
                <span className="log-raw">{event.raw}</span>
                {tp && (
                  <span className="turning-point-badge">
                    {tp.signalId}: {tp.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
