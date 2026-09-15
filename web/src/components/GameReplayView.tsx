import { useEffect, useMemo, useState } from "react";
import type { AnalyticsEvent } from "../types";
import { computeBoardStateAt, computeCheckpoints, derivePlayerNames, describeCheckpoint, getHighlight, type ReplayCard } from "../lib/gameReplay";
import { shortName } from "./RunList";

// Direct user feedback on an earlier version of this default (550ms): "way
// too fast... seven actions... I can't read through those as a human,"
// wanting roughly a quarter of that pace. 2200ms is the "1x" speed option
// below; faster options exist for someone who's already read a game once
// and wants to skim it.
const SPEED_OPTIONS = [
  { label: "0.5x", intervalMs: 4400 },
  { label: "1x", intervalMs: 2200 },
  { label: "2x", intervalMs: 1100 },
  { label: "4x", intervalMs: 550 },
] as const;
const DEFAULT_SPEED_INDEX = 1; // "1x" = 2200ms

/**
 * Replays one game's board state from its analyticsEvents - not a live/
 * real-time view (games here finish in seconds, nothing to watch live) but a
 * scrubbable, paced reconstruction, the same idea as a chess PGN viewer.
 *
 * Steps through *checkpoints* (see computeCheckpoints), not every raw event:
 * a real game's log is dominated by bookkeeping between the moments a person
 * actually cares about. Board state itself still replays every raw event up
 * to a checkpoint (computeBoardStateAt), so reconstruction accuracy is
 * unaffected - only what counts as one step changed.
 *
 * MVP scope, still: no hand contents, no card art (plain name/stat boxes) -
 * see the mtg-sim conversation this shipped from for the full reasoning and
 * what's intentionally deferred.
 */
export function GameReplayView({ events }: { events: AnalyticsEvent[] }) {
  const checkpoints = useMemo(() => {
    const cps = computeCheckpoints(events);
    return cps.length > 0 ? cps : [0]; // guard: a game with literally no meaningful moments still gets one step
  }, [events]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);

  const playerNames = useMemo(() => derivePlayerNames(events), [events]);
  const rawIndex = checkpoints[Math.min(pos, checkpoints.length - 1)];
  const board = useMemo(() => computeBoardStateAt(events, rawIndex, playerNames), [events, rawIndex, playerNames]);
  const currentEvent = events[rawIndex];
  const currentAction = currentEvent ? describeCheckpoint(currentEvent, shortName) : "";
  const highlight = useMemo(() => (currentEvent ? getHighlight(currentEvent) : { reactors: [] }), [currentEvent]);

  useEffect(() => {
    if (!playing) return;
    if (pos >= checkpoints.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setPos((p) => Math.min(p + 1, checkpoints.length - 1)), SPEED_OPTIONS[speedIndex].intervalMs);
    return () => clearTimeout(timer);
  }, [playing, pos, checkpoints.length, speedIndex]);

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
        <button type="button" className="secondary" onClick={() => setPos(0)} disabled={pos === 0}>
          &laquo;
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setPlaying(false);
            setPos((p) => Math.max(0, p - 1));
          }}
          disabled={pos === 0}
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
            setPos((p) => Math.min(checkpoints.length - 1, p + 1));
          }}
          disabled={pos >= checkpoints.length - 1}
        >
          &rsaquo;
        </button>
        <select
          className="replay-speed"
          value={speedIndex}
          onChange={(e) => setSpeedIndex(Number(e.target.value))}
          title="Playback speed"
        >
          {SPEED_OPTIONS.map((opt, i) => (
            <option key={opt.label} value={i}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={checkpoints.length - 1}
          value={pos}
          onChange={(e) => {
            setPlaying(false);
            setPos(Number(e.target.value));
          }}
          className="replay-scrubber"
        />
        <span className="muted replay-position">
          Turn {board.turn || 1} &middot; moment {pos + 1}/{checkpoints.length}
        </span>
      </div>

      {currentAction && <div className="replay-current-action">{currentAction}</div>}

      <div className="replay-board">
        {playerNames.map((player) => {
          const cards = battlefieldByPlayer.get(player) ?? [];
          const lands = cards.filter((c) => c.isLand);
          const permanents = cards.filter((c) => !c.isLand);
          const classes = ["replay-player"];
          if (board.activePlayer === player) classes.push("active-turn");
          if (highlight.actor === player) classes.push("actor");
          if (highlight.reactors.includes(player)) classes.push("reactor");
          return (
            <div key={player} className={classes.join(" ")}>
              <div className="replay-player-header">
                <strong>{shortName(player)}</strong>
                <span className="replay-life">{board.life[player] ?? "?"} life</span>
              </div>
              <div className="replay-battlefield replay-permanents">
                {permanents.map((card) => (
                  <ReplayCardBox key={card.id} card={card} attacking={board.attacks.some((a) => a.cardId === card.id)} blocking={board.blocks.some((b) => b.cardId === card.id)} />
                ))}
                {permanents.length === 0 && <span className="muted">(no permanents)</span>}
              </div>
              <div className="replay-battlefield replay-lands">
                {lands.map((card) => (
                  <ReplayCardBox key={card.id} card={card} attacking={false} blocking={false} />
                ))}
                {lands.length === 0 && <span className="muted">(no lands)</span>}
              </div>
            </div>
          );
        })}
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
      className={`replay-card${card.isLand ? " land" : ""}${card.tapped ? " tapped" : ""}${attacking ? " attacking" : ""}${blocking ? " blocking" : ""}`}
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
