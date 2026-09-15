import type { AnalyticsEvent } from "../types";

// Board reconstruction for the game replay viewer. Fed by the same
// analyticsEvents array every other view already uses (see
// AnalyticsEventLogger.java) - board-state-specific event types
// (zone_change's cardId/controller/power/toughness fields, card_tapped,
// card_counters, attackers_declared, blockers_declared, stack_removed) were
// added there specifically for this feature; every other event type here is
// just ignored by applyEvent's default case.

export interface ReplayCard {
  id: number;
  name: string;
  owner: string;
  controller: string;
  zone: string;
  tapped: boolean;
  power?: number;
  toughness?: number;
  counters: Record<string, number>;
}

export interface Attack {
  cardId: number;
  card: string;
  defender: string;
}

export interface Block {
  cardId: number;
  card: string;
  blockingCardId: number;
  blocking: string;
}

export interface StackItem {
  cardId: number;
  card: string;
  player: string;
}

export interface BoardState {
  cards: Map<number, ReplayCard>;
  life: Record<string, number>;
  stack: StackItem[];
  attacks: Attack[];
  blocks: Block[];
  turn: number;
  activePlayer: string | null;
  /** internal - which player's turn_began started round counting, so "Turn N" here matches the round number used everywhere else (Life Totals chart, awards, etc), not Forge's own raw per-player turn counter. */
  firstPlayer: string | null;
}

const STARTING_LIFE = 40; // Commander's starting life - life_change events are deltas from here, not absolutes until the first change.

function emptyBoard(playerNames: string[]): BoardState {
  const life: Record<string, number> = {};
  for (const p of playerNames) life[p] = STARTING_LIFE;
  return { cards: new Map(), life, stack: [], attacks: [], blocks: [], turn: 0, activePlayer: null, firstPlayer: null };
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Reconstructs board state by replaying analyticsEvents from the start
 * through (and including) `index`. Deliberately a full recompute-from-
 * scratch pure function rather than incremental/mutable state: event counts
 * here run in the hundreds to low thousands per game (cheap to replay in
 * full on every scrub), and a pure function can't accumulate
 * reconstruction bugs across steps the way stateful incremental updates
 * could - every board position is independently correct.
 */
export function computeBoardStateAt(events: AnalyticsEvent[], index: number, playerNames: string[]): BoardState {
  const board = emptyBoard(playerNames);
  const upTo = Math.min(index, events.length - 1);
  for (let i = 0; i <= upTo; i++) {
    applyEvent(board, events[i]);
  }
  return board;
}

/**
 * Which raw event indices are actually worth stopping on. A real game's
 * event log is dominated by bookkeeping (every mana tap, every incidental
 * zone change) between the moments a person actually cares about - user
 * feedback on the first version, watching a real game: "tons of events...
 * nothing happening through a lot of them" and combat text "so quick I
 * couldn't even read it." The replay now scrubs/steps through this list
 * instead of every raw event; computeBoardStateAt still replays every raw
 * event up to a checkpoint's index, so board state stays fully accurate -
 * this only changes what counts as one step.
 */
export function computeCheckpoints(events: AnalyticsEvent[]): number[] {
  const checkpoints: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case "turn_began":
      case "life_change":
      case "game_outcome":
      case "mulligan":
        checkpoints.push(i);
        break;
      case "spell_cast":
        if (e.action === "cast") checkpoints.push(i);
        break;
      case "attackers_declared":
        if (Array.isArray(e.attacks) && e.attacks.length > 0) checkpoints.push(i);
        break;
      case "blockers_declared":
        if (Array.isArray(e.blocks) && e.blocks.length > 0) checkpoints.push(i);
        break;
      case "zone_change":
        // A permanent leaving the battlefield (dying, being exiled) is a
        // real visual moment; the far more common hand/library churn
        // (drawing a card, playing a land) isn't worth its own stop.
        if (e.from === "Battlefield" && (e.to === "Graveyard" || e.to === "Exile")) checkpoints.push(i);
        break;
      default:
        break;
    }
  }
  return checkpoints;
}

/** A short, human-readable line for what happened at one checkpoint event - shown as the replay's "current action" so a fast-moving moment (an attack, a cast) is actually readable instead of flashing by as raw event text. `shortName` controls how player names are displayed (the caller already has a convention for this - see RunList.tsx). */
export function describeCheckpoint(event: AnalyticsEvent, shortName: (name: string) => string): string {
  const player = () => shortName(asStr(event.player) ?? "?");
  switch (event.type) {
    case "turn_began":
      return `${player()}'s turn begins`;
    case "life_change": {
      const from = asNum(event.oldLife);
      const to = asNum(event.newLife);
      const source = asStr(event.source);
      const delta = from !== undefined && to !== undefined ? `${from} → ${to}` : "";
      return `${player()}: ${delta}${source ? ` (${source})` : ""}`;
    }
    case "game_outcome": {
      const winner = asStr(event.winningPlayer);
      return winner ? `${shortName(winner)} wins the game` : "Game ends in a draw";
    }
    case "mulligan":
      return `${player()} mulligans to ${asNum(event.handSizeAfter) ?? "?"}`;
    case "spell_cast":
      return `${player()} casts ${asStr(event.card) ?? "?"}`;
    case "attackers_declared": {
      const attacks = Array.isArray(event.attacks) ? (event.attacks as Attack[]) : [];
      return `${player()} attacks: ${attacks.map((a) => `${a.card} → ${shortName(a.defender)}`).join(", ")}`;
    }
    case "blockers_declared": {
      const blocks = Array.isArray(event.blocks) ? (event.blocks as Block[]) : [];
      return `${player()} blocks: ${blocks.map((b) => `${b.card} blocks ${b.blocking}`).join(", ")}`;
    }
    case "zone_change":
      return `${asStr(event.card) ?? "A permanent"} goes to ${asStr(event.to)}`;
    default:
      return "";
  }
}

/**
 * Every distinct player name mentioned anywhere in the log - used when the
 * caller doesn't already know the roster. Deliberately does NOT read
 * "target": that field means a player on player_damaged, but a bracketed
 * card description (e.g. "[Wild-Magic Sorcerer (61)]") on spell_cast - a
 * real bug caught by checking actual output, where those card descriptions
 * (and one bare "[]" from an untargeted spell) showed up as bogus "player"
 * panels in the replay board.
 */
export function derivePlayerNames(events: AnalyticsEvent[]): string[] {
  const names = new Set<string>();
  for (const e of events) {
    for (const field of ["player", "owner", "controller"]) {
      const v = asStr(e[field]);
      if (v) names.add(v);
    }
  }
  return [...names];
}

function applyEvent(board: BoardState, event: AnalyticsEvent): void {
  switch (event.type) {
    case "turn_began": {
      // Forge's own turn_began.turn counts every individual player's turn
      // (P1=1, P2=2, P3=3, P4=4, P1 again=5...), not a round - the same
      // inflation already fixed in gameStats.ts for the Life Totals chart
      // and awards. Replicated here (round = how many times the observed
      // first player's turn comes back around) so the replay's "Turn N"
      // actually matches what's shown everywhere else in the run instead
      // of showing e.g. "Turn 35" for what the rest of the UI calls turn 9
      // - a real inconsistency caught by comparing the replay against the
      // Life Totals chart for the same game before shipping this.
      const player = asStr(event.player);
      if (board.firstPlayer === null) {
        board.firstPlayer = player ?? null;
        board.turn = 1;
      } else if (player === board.firstPlayer) {
        board.turn += 1;
      }
      board.activePlayer = player ?? board.activePlayer;
      // A new turn means last turn's combat is resolved and over.
      board.attacks = [];
      board.blocks = [];
      break;
    }
    case "zone_change": {
      const id = asNum(event.cardId);
      if (id === undefined) break;
      const existing = board.cards.get(id);
      const to = asStr(event.to) ?? "Unknown";
      board.cards.set(id, {
        id,
        name: asStr(event.card) ?? existing?.name ?? "?",
        owner: asStr(event.owner) ?? existing?.owner ?? "",
        controller: asStr(event.controller) ?? existing?.controller ?? "",
        zone: to,
        // A permanent always enters untapped; a card leaving the battlefield
        // has no meaningful tapped state, reset so a graveyard card doesn't
        // render tapped if it dies while tapped.
        tapped: to === "Battlefield" ? false : false,
        power: asNum(event.power) ?? existing?.power,
        toughness: asNum(event.toughness) ?? existing?.toughness,
        // Counters reset on a genuine zone change (a permanent that returns
        // to the battlefield is a new object under the rules, even though
        // this engine reuses the same tracking id) - stale +1/+1 counters
        // from a prior stint on the battlefield shouldn't carry over.
        counters: {},
      });
      break;
    }
    case "card_tapped": {
      const id = asNum(event.cardId);
      if (id === undefined) break;
      const card = board.cards.get(id);
      if (card) card.tapped = event.tapped === true;
      break;
    }
    case "card_counters": {
      const id = asNum(event.cardId);
      const type = asStr(event.counterType);
      if (id === undefined || !type) break;
      const card = board.cards.get(id);
      if (card) card.counters[type] = asNum(event.newValue) ?? 0;
      break;
    }
    case "spell_cast": {
      // Only a genuine cast puts something visible on the stack - a
      // triggered/activated ability's "source" stays wherever it already
      // is (usually the battlefield), so showing it as a stack item too
      // would double up the same card in two places at once.
      if (event.action !== "cast") break;
      const cardId = asNum(event.cardId);
      const card = asStr(event.card);
      const player = asStr(event.player);
      if (cardId === undefined || !card || !player) break;
      board.stack.push({ cardId, card, player });
      break;
    }
    case "stack_removed": {
      const id = asNum(event.cardId);
      if (id === undefined) break;
      const idx = board.stack.findIndex((s) => s.cardId === id);
      if (idx !== -1) board.stack.splice(idx, 1);
      break;
    }
    case "attackers_declared": {
      board.attacks = Array.isArray(event.attacks) ? (event.attacks as Attack[]) : [];
      break;
    }
    case "blockers_declared": {
      board.blocks = Array.isArray(event.blocks) ? (event.blocks as Block[]) : [];
      break;
    }
    case "life_change": {
      const player = asStr(event.player);
      const newLife = asNum(event.newLife);
      if (player && newLife !== undefined) board.life[player] = newLife;
      break;
    }
    default:
      break;
  }
}
