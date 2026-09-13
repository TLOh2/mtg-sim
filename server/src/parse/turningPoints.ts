import type { GameEvent, TurningPoint } from "./types.js";

// Heuristic detectors for spec.json#turning_point_signals. These are a first
// pass over Forge's plain-text log, not a structured event API from the
// engine - expect to refine thresholds/heuristics once more real games have
// been examined (spec.json says as much: "expected to be refined").
//
// One signal from spec.json's seed list, "big_card_draw", is NOT implemented
// here: Forge's GameLogEntryType enum has no draw-related entry at all (only
// DISCARD is logged - confirmed by reading forge-game's Player.java, the
// only caller that logs a hand-size-changing event other than discard).
// Individual card draws simply aren't recorded in the log Forge emits, so
// this signal isn't detectable without instrumenting the engine itself. Left
// out rather than faking a heuristic with no textual basis.

const LIFE_DELTA = /(-?\d+)\s*>\s*(-?\d+)\s*$/;
const GRAVEYARD_FROM_BATTLEFIELD = /was put into Graveyard from Battlefield/;
const COMBAT_DAMAGE_TO = (player: string) =>
  new RegExp(`combat damage to ${escapeRegex(player)}\\b`);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface TurningPointOptions {
  /** playerName -> that player's commander card name(s), for commander_cast_or_recast. */
  commandersByPlayer?: Record<string, string[]>;
}

export function detectTurningPoints(events: GameEvent[], opts: TurningPointOptions = {}): TurningPoint[] {
  const points: TurningPoint[] = [];
  const eliminated = new Set<string>();

  detectLifeSwingsAndEliminations(events, points, eliminated);
  detectClusteredZoneChanges(events, points);
  detectExtraTurns(events, points);
  detectComboLoops(events, points);
  detectKeyCounterspells(events, points);
  if (opts.commandersByPlayer) detectCommanderCasts(events, points, opts.commandersByPlayer);

  return points.sort((a, b) => a.eventIndex - b.eventIndex);
}

function detectLifeSwingsAndEliminations(
  events: GameEvent[],
  points: TurningPoint[],
  eliminated: Set<string>,
) {
  events.forEach((event, i) => {
    if (event.type !== "LIFE") return;
    const match = event.raw.match(LIFE_DELTA);
    if (!match || event.playersInvolved.length !== 1) return;

    const player = event.playersInvolved[0];
    const oldLife = Number(match[1]);
    const newLife = Number(match[2]);
    const delta = Math.abs(newLife - oldLife);

    if (delta >= 10) {
      points.push({
        signalId: "large_life_swing",
        eventIndex: event.index,
        description: `${player}'s life changed from ${oldLife} to ${newLife} (${delta > 0 ? "-" : "+"}${delta})`,
      });
    }

    if (newLife <= 0 && !eliminated.has(player)) {
      eliminated.add(player);
      const recentCombatDamage = events
        .slice(Math.max(0, i - 5), i)
        .some((e) => e.type === "DAMAGE" && COMBAT_DAMAGE_TO(player).test(e.raw));

      points.push({
        signalId: recentCombatDamage ? "lethal_combat" : "player_elimination",
        eventIndex: event.index,
        description: recentCombatDamage
          ? `${player} was eliminated by combat damage (life reached ${newLife})`
          : `${player} was eliminated (life reached ${newLife})`,
      });
    }
  });
}

/**
 * Shared clustering pass for board_wipe and mass_land_destruction: both are
 * "several permanents leave the battlefield to the graveyard at once, via a
 * spell/ability rather than combat". Distinguished from ordinary combat
 * deaths by requiring no COMBAT-type event in the same window; distinguished
 * from each other by whether a nearby stack event's text mentions "land".
 */
function detectClusteredZoneChanges(events: GameEvent[], points: TurningPoint[]) {
  const WINDOW = 8;
  const THRESHOLD = 3;

  let i = 0;
  while (i < events.length) {
    if (events[i].type !== "ZONE_CHANGE" || !GRAVEYARD_FROM_BATTLEFIELD.test(events[i].raw)) {
      i++;
      continue;
    }

    const windowEnd = Math.min(events.length, i + WINDOW);
    const window = events.slice(i, windowEnd);
    const clusterCount = window.filter(
      (e) => e.type === "ZONE_CHANGE" && GRAVEYARD_FROM_BATTLEFIELD.test(e.raw),
    ).length;
    const hasCombat = window.some((e) => e.type === "COMBAT");

    if (clusterCount >= THRESHOLD && !hasCombat) {
      const contextWindow = events.slice(Math.max(0, i - 4), windowEnd);
      const landMentioned = contextWindow.some(
        (e) => (e.type === "STACK_ADD" || e.type === "STACK_RESOLVE") && /land/i.test(e.raw),
      );
      points.push({
        signalId: landMentioned ? "mass_land_destruction" : "board_wipe",
        eventIndex: events[i].index,
        description: `${clusterCount} permanents went to the graveyard from the battlefield without combat`,
      });
      i = windowEnd; // don't re-flag the same cluster repeatedly
      continue;
    }
    i++;
  }
}

function detectExtraTurns(events: GameEvent[], points: TurningPoint[]) {
  let lastTurnPlayers: string[] | null = null;
  for (const event of events) {
    if (event.type !== "TURN") continue;
    if (
      lastTurnPlayers &&
      event.playersInvolved.length === 1 &&
      lastTurnPlayers.length === 1 &&
      event.playersInvolved[0] === lastTurnPlayers[0]
    ) {
      points.push({
        signalId: "extra_turn",
        eventIndex: event.index,
        description: `${event.playersInvolved[0]} took consecutive turns (extra turn)`,
      });
    }
    lastTurnPlayers = event.playersInvolved;
  }
}

function detectComboLoops(events: GameEvent[], points: TurningPoint[]) {
  const WINDOW = 10;
  const THRESHOLD = 4;
  const stackAdds = events.filter((e) => e.type === "STACK_ADD");
  const flagged = new Set<string>();

  for (let i = 0; i < stackAdds.length; i++) {
    const window = stackAdds.slice(Math.max(0, i - WINDOW + 1), i + 1);
    const repeats = window.filter((e) => e.raw === stackAdds[i].raw).length;
    if (repeats >= THRESHOLD && !flagged.has(stackAdds[i].raw)) {
      flagged.add(stackAdds[i].raw);
      points.push({
        signalId: "combo_loop_detected",
        eventIndex: stackAdds[i].index,
        description: `The same action repeated ${repeats} times in a short window (possible loop): "${stackAdds[i].raw}"`,
      });
    }
  }
}

function detectKeyCounterspells(events: GameEvent[], points: TurningPoint[]) {
  // No mana-value data in the text log, so this can't apply spec.json's
  // ">= 5 mana value" threshold - flags every resolved counter instead.
  // Revisit once card-data lookups are available to the parser.
  for (const event of events) {
    if (event.type === "STACK_RESOLVE" && /\bcounters?\b.*\bspell\b/i.test(event.raw)) {
      points.push({
        signalId: "key_counterspell",
        eventIndex: event.index,
        description: `A spell was countered: "${event.raw}"`,
      });
    }
  }
}

function detectCommanderCasts(
  events: GameEvent[],
  points: TurningPoint[],
  commandersByPlayer: Record<string, string[]>,
) {
  for (const event of events) {
    if (event.type !== "STACK_ADD") continue;
    const castMatch = event.raw.match(/^Add To Stack: (.+?) cast (.+?)(?: targeting .*)?$/);
    if (!castMatch) continue;
    const [, player, cardName] = castMatch;
    const commanders = commandersByPlayer[player];
    if (commanders?.includes(cardName)) {
      points.push({
        signalId: "commander_cast_or_recast",
        eventIndex: event.index,
        description: `${player} cast their commander, ${cardName}, from the command zone`,
      });
    }
  }
}
