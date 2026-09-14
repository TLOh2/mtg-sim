import type { DeckAggregateStats } from "./gameStats.js";

// Lightweight, fun "who won what" callouts for a single run - every one of
// these is a plain max/min pass over DeckAggregateStats, which already
// exists (see gameStats.ts computeRunAggregateStats), so this is
// deliberately just a presentation layer on top of numbers already being
// computed, not new data collection.
//
// Award categories are picked to be safely superlative: each one only
// crowns a winner when there's a genuine, meaningfully nonzero signal to
// rank on (see minValue/requireSignal below) - a run where nobody dealt any
// non-combat damage shouldn't hand out a "Pyromaniac" award to whichever
// deck happens to have 0 first in sort order.
//
// Deliberately NOT included here (see mtg-sim project memory /
// spec.json-adjacent backlog notes): "most instant-speed removal" - Forge's
// card-type data (see cardTypes/lookupCardTypes.ts) can tell you a card is
// an Instant, but not that it's specifically removal (destroy/exile a
// permanent) versus a counterspell or combat trick. That needs external
// card-function data (Scryfall tags, or a hand-curated list) this project
// deliberately doesn't guess at - see importers/moxfieldText.ts and
// archidekt.ts for the same do_not_guess policy applied elsewhere.

export interface Award {
  id: string;
  title: string;
  description: string;
  player: string;
  /** Pre-formatted for display (e.g. "14.3 dmg/game", "turn 4.2") - the underlying numbers have wildly different units and scales, so formatting lives here rather than asking the UI to know each award's unit. */
  value: string;
}

interface AwardSpec {
  id: string;
  title: string;
  description: string;
  /** Higher wins ("most X") or lower wins ("fastest X", "fewest X"). */
  direction: "max" | "min";
  metric: (a: DeckAggregateStats) => number | null;
  format: (v: number) => string;
  /** Only consider decks whose metric is strictly greater than this (after sign-flipping for "min" direction, checked pre-flip against the raw metric) - guards against crowning a winner when every deck is at a floor value (0 damage, 0 mulligans, ...) that isn't really a signal of anything. Defaults to requiring > 0. */
  minSignal?: number;
}

const AWARD_SPECS: AwardSpec[] = [
  {
    id: "most-damage",
    title: "Most Damage Dealt",
    description: "Total damage (combat + non-combat), averaged per game.",
    direction: "max",
    metric: (a) => a.avgCombatDamageDealt + a.avgNonCombatDamageDealt,
    format: (v) => `${v.toFixed(1)} dmg/game`,
  },
  {
    id: "pyromaniac",
    title: "Pyromaniac",
    description: "Most non-combat damage dealt (burn spells, pingers, alt win-cons) per game.",
    direction: "max",
    metric: (a) => a.avgNonCombatDamageDealt,
    format: (v) => `${v.toFixed(1)} dmg/game`,
  },
  {
    id: "speedrunner",
    title: "Speedrunner",
    description: "Fastest average turn to close out a win.",
    direction: "min",
    metric: (a) => a.avgWinningGameTurn,
    format: (v) => `turn ${v.toFixed(1)}`,
  },
  {
    id: "iron-bank",
    title: "Iron Bank",
    description: "Most life drained from opponents via non-damage effects, per game.",
    direction: "max",
    metric: (a) => a.avgNonDamageLifeLossDealt,
    format: (v) => `${v.toFixed(1)} life/game`,
  },
  {
    id: "most-consistent",
    title: "Most Consistent",
    description: "Fewest turns with a land stuck unplayed in hand, per game.",
    direction: "min",
    metric: (a) => (a.avgManaEfficiency !== null ? a.avgMissedLandDrops : null),
    format: (v) => `${v.toFixed(1)} missed drops/game`,
    minSignal: -1, // 0 missed land drops is itself the good outcome here, so allow it.
  },
  {
    id: "rocky-start",
    title: "Rocky Start",
    description: "Most mulligans taken, per game - a dubious honor.",
    direction: "max",
    metric: (a) => a.avgMulligans,
    format: (v) => `${v.toFixed(1)} mulligans/game`,
  },
];

/**
 * One winner per category in AWARD_SPECS, computed from a single run's own
 * aggregate stats (not cross-run). A category is omitted entirely (not
 * shown with a 0/null winner) when no deck has a real signal for it - see
 * AwardSpec.minSignal.
 */
export function computeAwards(aggregate: DeckAggregateStats[]): Award[] {
  const awards: Award[] = [];

  for (const spec of AWARD_SPECS) {
    const minSignal = spec.minSignal ?? 0;
    const candidates = aggregate
      .map((a) => ({ player: a.player, value: spec.metric(a) }))
      .filter((c): c is { player: string; value: number } => c.value !== null && c.value > minSignal);

    if (candidates.length === 0) continue;

    const winner = candidates.reduce((best, c) =>
      spec.direction === "max" ? (c.value > best.value ? c : best) : c.value < best.value ? c : best,
    );

    awards.push({
      id: spec.id,
      title: spec.title,
      description: spec.description,
      player: winner.player,
      value: spec.format(winner.value),
    });
  }

  return awards;
}
