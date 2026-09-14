import type { AnalyticsEvent } from "../types";
import { shortName } from "./RunList";

// Turns the structured analyticsEvents stream (see AnalyticsEventLogger.java)
// into plain-English lines grouped by turn - the readable alternative to the
// raw Forge log dump in GameLogView. Turn numbers are converted from Forge's
// own per-player-turn count (P1's turn is 1, P2's is 2, ... P1's second turn
// is 5 in a 4-player pod) into round numbers (one lap of the table) the same
// way server/src/analyze/gameStats.ts does - anchored to whoever's turn_began
// came first, so it stays correct through eliminations rather than assuming
// a fixed player count.
//
// Deliberately not exhaustive - zone_change alone fires ~15-25x/turn (every
// draw is one), so this picks out the events that make for a readable story
// (lands, spells, damage, life swings, deaths/discards/exiles, mulligans,
// the final outcome) and quietly summarizes card draws as a per-turn count
// per player rather than one line per card.

function str(e: AnalyticsEvent, key: string): string | null {
  const v = e[key];
  return typeof v === "string" ? v : null;
}
function num(e: AnalyticsEvent, key: string): number | null {
  const v = e[key];
  return typeof v === "number" ? v : null;
}
function bool(e: AnalyticsEvent, key: string): boolean {
  return e[key] === true;
}

interface TurnGroup {
  turn: number;
  activePlayer: string | null;
  lines: { key: string; node: React.ReactNode; kind?: string }[];
}

export function GameStoryView({ events }: { events: AnalyticsEvent[] }) {
  const groups: TurnGroup[] = [{ turn: 0, activePlayer: null, lines: [] }];
  let current = groups[0];
  let lineKey = 0;
  let firstPlayer: string | null = null;
  let round = 0;

  // Draws are extremely frequent and uninteresting one at a time - tally
  // them per (turn, player) and emit one summary line when the turn advances
  // or the game ends, instead of a line per card.
  let drawCounts = new Map<string, number>();
  function flushDraws() {
    for (const [player, count] of drawCounts) {
      current.lines.push({
        key: `draw-${lineKey++}`,
        node: (
          <>
            <span className="player-name">{shortName(player)}</span> drew {count} card{count === 1 ? "" : "s"}.
          </>
        ),
      });
    }
    drawCounts = new Map();
  }

  for (const event of events) {
    switch (event.type) {
      case "turn_began": {
        const turn = num(event, "turn");
        const player = str(event, "player");
        if (turn !== null) {
          if (firstPlayer === null) {
            firstPlayer = player;
            round = 1;
          } else if (player === firstPlayer) {
            round += 1;
          }
          flushDraws();
          current = { turn: round, activePlayer: player, lines: [] };
          groups.push(current);
        }
        break;
      }
      case "mulligan": {
        const player = str(event, "player");
        const handSize = num(event, "handSizeAfter");
        if (player) {
          current.lines.push({
            key: `mull-${lineKey++}`,
            kind: "mulligan",
            node: (
              <>
                <span className="player-name">{shortName(player)}</span> kept a hand of {handSize} card
                {handSize === 1 ? "" : "s"}.
              </>
            ),
          });
        }
        break;
      }
      case "land_played": {
        const player = str(event, "player");
        const card = str(event, "card");
        if (player && card) {
          current.lines.push({
            key: `land-${lineKey++}`,
            node: (
              <>
                <span className="player-name">{shortName(player)}</span> played <em>{card}</em>.
              </>
            ),
          });
        }
        break;
      }
      case "spell_cast": {
        const player = str(event, "player");
        const card = str(event, "card");
        const action = str(event, "action") ?? "cast";
        const target = str(event, "target");
        if (player && card) {
          current.lines.push({
            key: `cast-${lineKey++}`,
            node: (
              <>
                <span className="player-name">{shortName(player)}</span> {action} <em>{card}</em>
                {target ? ` targeting ${target}` : ""}.
              </>
            ),
          });
        }
        break;
      }
      case "zone_change": {
        const to = str(event, "to");
        const from = str(event, "from");
        const card = str(event, "card");
        const owner = str(event, "owner");
        if (from === "Library" && to === "Hand" && owner) {
          // Skip turn 0 (setup): the London mulligan rule redraws a fresh 7
          // on every mulligan, so a player who mulligans twice shows 21 raw
          // draws here despite ending on a 5-card hand - the mulligan lines
          // below already report the real, final hand size accurately per
          // checkpoint, so counting these too would just be confusing noise
          // stacked on top of correct information.
          if (current.turn > 0) {
            drawCounts.set(owner, (drawCounts.get(owner) ?? 0) + 1);
          }
        } else if ((to === "Graveyard" || to === "Exile") && card) {
          current.lines.push({
            key: `zone-${lineKey++}`,
            node: (
              <>
                <em>{card}</em>
                {owner ? ` (${shortName(owner)})` : ""} went to {to.toLowerCase()}
                {from ? ` from ${from.toLowerCase()}` : ""}.
              </>
            ),
          });
        }
        break;
      }
      case "life_change": {
        const player = str(event, "player");
        const oldLife = num(event, "oldLife");
        const newLife = num(event, "newLife");
        if (player && oldLife !== null && newLife !== null) {
          current.lines.push({
            key: `life-${lineKey++}`,
            node: (
              <>
                <span className="player-name">{shortName(player)}</span>'s life: {oldLife} &rarr; {newLife}
                {newLife <= 0 ? " (eliminated)" : ""}
              </>
            ),
          });
        }
        break;
      }
      case "player_damaged": {
        const target = str(event, "target");
        const source = str(event, "source");
        const amount = num(event, "amount");
        const combat = bool(event, "combat");
        if (target && amount !== null) {
          current.lines.push({
            key: `dmg-${lineKey++}`,
            node: (
              <>
                <span className="player-name">{shortName(target)}</span> took {amount} {combat ? "combat" : "non-combat"}{" "}
                damage{source ? ` from ${source}` : ""}.
              </>
            ),
          });
        }
        break;
      }
      case "game_outcome": {
        flushDraws();
        const winner = str(event, "winningPlayer");
        // event.lastTurn is Forge's raw per-player-turn count, not a round
        // number - use the round we've been tracking instead (it already
        // reflects the latest one, since turn_began always precedes this).
        current.lines.push({
          key: `outcome-${lineKey++}`,
          kind: "outcome",
          node: winner ? (
            <>
              {shortName(winner)} won on turn {round}.
            </>
          ) : (
            <>The game ended in a draw{round > 0 ? ` on turn ${round}` : ""}.</>
          ),
        });
        break;
      }
      default:
        break;
    }
  }
  flushDraws();

  const nonEmptyGroups = groups.filter((g) => g.lines.length > 0);

  if (nonEmptyGroups.length === 0) {
    return <p className="muted">No structured events captured for this game (older run, or Forge build predates the analytics logger).</p>;
  }

  return (
    <div className="game-story">
      {nonEmptyGroups.map((g) => (
        <div className="story-turn-group" key={g.turn}>
          <div className="story-turn-heading">
            {g.turn === 0 ? "Setup" : `Turn ${g.turn}${g.activePlayer ? ` — ${shortName(g.activePlayer)}` : ""}`}
          </div>
          {g.lines.map((line) => (
            <div className={`story-line${line.kind ? ` story-${line.kind}` : ""}`} key={line.key}>
              {line.node}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
