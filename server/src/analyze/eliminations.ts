import type { AnalyticsEvent, GameEvent } from "../parse/types.js";

export type EliminationCause = "damage" | "life loss" | "commander damage" | "poison" | "decked" | "other";

export interface FinisherCard {
  card: string;
  /** Damage (or life loss) this card dealt in the finishing batch; null when unknowable (e.g. decking). */
  amount: number | null;
  /** How many same-named sources contributed (three Goblin Tokens attacking together = 3). */
  count: number;
}

export interface Elimination {
  player: string;
  /** Round of the knockout, counted the same way as gameStats (one round = every seat's turn); null if unknown. */
  turn: number | null;
  cause: EliminationCause;
  /** Seat whose card(s) landed the finishing blow - the controller of the biggest contributor. */
  by: string | null;
  /** Every card in the finishing batch, biggest contributor first. */
  cards: FinisherCard[];
  /** Forge's own loss reason, kept for causes this doesn't classify. */
  detail?: string;
}

interface Hit {
  source: string;
  amount: number;
  combat: boolean;
  infect: boolean;
}

interface Finish {
  turn: number;
  cause: EliminationCause;
  hits: Hit[];
}

const COMMANDER_DAMAGE_LETHAL = 21;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function groupHits(hits: Hit[]): FinisherCard[] {
  const byCard = new Map<string, FinisherCard>();
  for (const h of hits) {
    const existing = byCard.get(h.source);
    if (existing) {
      existing.amount = (existing.amount ?? 0) + h.amount;
      existing.count += 1;
    } else {
      byCard.set(h.source, { card: h.source, amount: h.amount, count: 1 });
    }
  }
  return [...byCard.values()].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
}

function classify(reason: string): EliminationCause {
  if (/life total/i.test(reason)) return "damage";
  if (/generals|commander/i.test(reason)) return "commander damage";
  if (/poison/i.test(reason)) return "poison";
  if (/library/i.test(reason)) return "decked";
  return "other";
}

/**
 * Who knocked out whom, and with what. Forge reports damage as one
 * player_damaged event per source followed by a single combined life_change,
 * so a lethal combat step with seven attackers really is seven cards - every
 * source in the batch that took a player to 0 is a finisher, not just
 * whichever happened to be listed last. Forge's own text log supplies the
 * authoritative list of losers and why (commander damage and poison don't
 * show up as a life total crossing 0).
 */
export function computeEliminations(
  analyticsEvents: AnalyticsEvent[],
  textEvents: GameEvent[],
  commandersByPlayer: Record<string, string[]>,
): Elimination[] {
  const commanders = new Set(Object.values(commandersByPlayer).flat());
  const controllerOf = new Map<string, string>();
  const pending = new Map<string, Hit[]>();
  const commanderDamage = new Map<string, number>();
  const lifeFinish = new Map<string, Finish>();
  const commanderFinish = new Map<string, Finish>();
  const lastInfect = new Map<string, Finish>();

  let firstPlayer: string | null = null;
  let turn = 0;

  for (const event of analyticsEvents) {
    switch (event.type) {
      case "turn_began": {
        const player = str(event.player);
        if (firstPlayer === null) {
          firstPlayer = player;
          turn = 1;
        } else if (player === firstPlayer) {
          turn += 1;
        }
        break;
      }
      case "spell_cast":
      case "land_played": {
        const card = str(event.card);
        const player = str(event.player);
        if (card && player) controllerOf.set(card, player);
        break;
      }
      case "zone_change": {
        const card = str(event.card);
        const controller = str(event.controller);
        if (card && controller) controllerOf.set(card, controller);
        break;
      }
      case "attackers_declared": {
        const player = str(event.player);
        if (player && Array.isArray(event.attacks)) {
          for (const a of event.attacks as { card?: unknown }[]) {
            const card = str(a.card);
            if (card) controllerOf.set(card, player);
          }
        }
        break;
      }
      case "player_damaged": {
        const target = str(event.target);
        if (!target) break;
        const hit: Hit = {
          source: str(event.source) ?? "Unknown source",
          amount: num(event.amount) ?? 0,
          combat: event.combat === true,
          infect: event.infect === true,
        };
        if (!pending.has(target)) pending.set(target, []);
        pending.get(target)!.push(hit);

        if (hit.combat && commanders.has(hit.source) && !commanderFinish.has(target)) {
          const key = `${target}#${hit.source}`;
          const total = (commanderDamage.get(key) ?? 0) + hit.amount;
          commanderDamage.set(key, total);
          if (total >= COMMANDER_DAMAGE_LETHAL) {
            commanderFinish.set(target, { turn, cause: "commander damage", hits: [hit] });
          }
        }
        if (hit.infect) lastInfect.set(target, { turn, cause: "poison", hits: [hit] });
        break;
      }
      case "life_change": {
        const player = str(event.player);
        if (!player) break;
        const isDamage = event.isDamage === true;
        const batch = isDamage ? (pending.get(player) ?? []) : [];
        if (isDamage) pending.set(player, []);

        const oldLife = num(event.oldLife);
        const newLife = num(event.newLife);
        if (oldLife === null || newLife === null || oldLife <= 0 || newLife > 0 || lifeFinish.has(player)) break;

        const hits: Hit[] = isDamage
          ? batch
          : [{ source: str(event.source) ?? "Unknown source", amount: oldLife - newLife, combat: false, infect: false }];
        lifeFinish.set(player, { turn, cause: isDamage ? "damage" : "life loss", hits });
        break;
      }
      default:
        break;
    }
  }

  const toElimination = (player: string, finish: Finish | undefined, cause: EliminationCause, detail?: string): Elimination => {
    const cards = finish ? groupHits(finish.hits) : [];
    return {
      player,
      turn: finish?.turn ?? null,
      cause: finish?.cause ?? cause,
      // A stolen or reanimated attacker may never have been seen under its new
      // controller - fall back to the biggest contributor whose controller is known.
      by: cards.map((c) => controllerOf.get(c.card)).find((p) => p !== undefined) ?? null,
      cards,
      ...(detail ? { detail } : {}),
    };
  };

  const eliminations: Elimination[] = [];
  const seen = new Set<string>();
  for (const e of textEvents) {
    if (e.type !== "GAME_OUTCOME") continue;
    const m = e.raw.match(/Game Outcome: (.+?) has lost (.+)$/);
    if (!m) continue;
    const [, player, reason] = m;
    if (seen.has(player)) continue;
    seen.add(player);

    const cause = classify(reason);
    if (cause === "damage") eliminations.push(toElimination(player, lifeFinish.get(player), cause));
    else if (cause === "commander damage") eliminations.push(toElimination(player, commanderFinish.get(player), cause));
    else if (cause === "poison") eliminations.push(toElimination(player, lastInfect.get(player), cause));
    else if (cause === "decked") eliminations.push(toElimination(player, undefined, cause));
    else eliminations.push(toElimination(player, undefined, cause, reason.trim()));
  }

  // Runs whose text log has no outcome lines (shouldn't happen, but older
  // runs were parsed by earlier code) still get the life-based knockouts.
  if (eliminations.length === 0) {
    for (const [player, finish] of lifeFinish) eliminations.push(toElimination(player, finish, finish.cause));
  }

  return eliminations
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.turn ?? Infinity) - (b.e.turn ?? Infinity) || a.i - b.i)
    .map(({ e }) => e);
}
