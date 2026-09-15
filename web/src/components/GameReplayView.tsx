import { useEffect, useMemo, useState } from "react";
import type { AnalyticsEvent } from "../types";
import { computeBoardStateAt, derivePlayerNames, type ReplayCard } from "../lib/gameReplay";
import { shortName } from "./RunList";

const PLAY_INTERVAL_MS = 350;

/**
 * Replays one game's board state from its analyticsEvents, event by event -
 * not a live/real-time view (games here finish in seconds, nothing to watch
 * live) but a scrubbable, paced reconstruction, the same idea as a chess PGN
 * viewer. MVP scope, deliberately: battlefield + life + stack only, no hand
 * contents, no card art (plain name/stat boxes) - see the mtg-sim
 * conversation this shipped from for the full reasoning.
 */
export function GameReplayView({ events }: { events: AnalyticsEvent[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const playerNames = useMemo(() => derivePlayerNames(events), [events]);
  const board = useMemo(() => computeBoardStateAt(events, index, playerNames), [events, index, playerNames]);

  useEffect(() => {
    if (!playing) return;
    if (index >= events.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, events.length - 1)), PLAY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [playing, index, events.length]);

  if (events.length === 0) {
    return <p className="muted">No board-state events captured for this game (older run, predates the replay feature).</p>;
  }

  const battlefieldByPlayer = new Map<string, ReplayCard[]>();
  for (const player of playerNames) battlefieldByPlayer.set(player, []);
  for (const card of board.cards.values()) {
    if (card.zone !== "Battlefield") continue;
    const list = battlefieldByPlayer.get(card.controller);
    if (list) list.push(card);
    else battlefieldByPlayer.set(card.controller, [card]);
  }

  return (
    <div className="replay-view">
      <div className="replay-controls">
        <button type="button" className="secondary" onClick={() => setIndex(0)} disabled={index === 0}>
          &laquo;
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setPlaying(false);
            setIndex((i) => Math.max(0, i - 1));
          }}
          disabled={index === 0}
        >
          &lsaquo;
        </button>
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setPlaying(false);
            setIndex((i) => Math.min(events.length - 1, i + 1));
          }}
          disabled={index >= events.length - 1}
        >
          &rsaquo;
        </button>
        <input
          type="range"
          min={0}
          max={events.length - 1}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          className="replay-scrubber"
        />
        <span className="muted replay-position">
          Turn {board.turn || 1} &middot; event {index + 1}/{events.length}
        </span>
      </div>

      <div className="replay-board">
        {playerNames.map((player) => (
          <div key={player} className="replay-player">
            <div className="replay-player-header">
              <strong>{shortName(player)}</strong>
              <span className={board.activePlayer === player ? "replay-life active-turn" : "replay-life"}>
                {board.life[player] ?? "?"} life
              </span>
            </div>
            <div className="replay-battlefield">
              {(battlefieldByPlayer.get(player) ?? []).map((card) => (
                <ReplayCardBox key={card.id} card={card} attacking={board.attacks.some((a) => a.cardId === card.id)} blocking={board.blocks.some((b) => b.cardId === card.id)} />
              ))}
              {(battlefieldByPlayer.get(player) ?? []).length === 0 && <span className="muted">(empty battlefield)</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="replay-stack">
        <h4>Stack</h4>
        {board.stack.length === 0 && <span className="muted">(empty)</span>}
        {[...board.stack].reverse().map((item, i) => (
          <div key={`${item.cardId}-${i}`} className="replay-stack-item">
            {item.card} <span className="muted">({shortName(item.player)})</span>
          </div>
        ))}
      </div>

      {(board.attacks.length > 0 || board.blocks.length > 0) && (
        <div className="replay-combat">
          {board.attacks.map((a, i) => (
            // key includes the array index, not just cardId: a creature
            // that can attack more than one thing at once (rare, but a few
            // cards allow it) would otherwise declare two attacks with the
            // same cardId and collide - a real React key-collision warning
            // caught in the browser, not a hypothetical.
            <div key={`${a.cardId}-${i}`} className="muted">
              {a.card} attacking {shortName(a.defender)}
            </div>
          ))}
          {board.blocks.map((b, i) => (
            <div key={`${b.cardId}-${b.blockingCardId}-${i}`} className="muted">
              {b.card} blocking {b.blocking}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplayCardBox({ card, attacking, blocking }: { card: ReplayCard; attacking: boolean; blocking: boolean }) {
  const counterText = Object.entries(card.counters)
    .filter(([, v]) => v !== 0)
    .map(([type, v]) => `${type} x${v}`)
    .join(", ");
  return (
    <div
      className={`replay-card${card.tapped ? " tapped" : ""}${attacking ? " attacking" : ""}${blocking ? " blocking" : ""}`}
      title={card.name}
    >
      <div className="replay-card-name">{card.name}</div>
      {card.power !== undefined && (
        <div className="replay-card-pt">
          {card.power}/{card.toughness}
        </div>
      )}
      {counterText && <div className="replay-card-counters">{counterText}</div>}
    </div>
  );
}
