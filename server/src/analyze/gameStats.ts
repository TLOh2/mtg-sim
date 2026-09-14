import type { AnalyticsEvent } from "../parse/types.js";
import type { AnalyzedGame } from "./types.js";

// Turns raw analyticsEvents (see AnalyticsEventLogger.java) into per-player,
// per-game numbers - and those, aggregated across a run's games, into rough
// per-deck signals (mana consistency, a "power bracket" guess). Everything
// here is derived on read from already-persisted data, not stored on disk,
// so the formulas below can be tuned without re-running any simulations.
//
// Two honesty notes, consistent with turningPoints.ts's own caveats:
// - analyticsEvents don't carry a turn number directly (only turn_began
//   events do) - every event's turn is inferred by scanning forward from the
//   most recent turn_began, which is exact (events are strictly ordered)
//   but means "turn 0" covers everything before turn 1 begins (draws,
//   mulligans, opening triggers).
// - "manaIssueFlag" and "powerBracketEstimate" are deliberately simple,
//   labeled-as-rough heuristics over Phase 1 data (land drops, mulligans,
//   win rate, game length) - not a rigorous rating. See mtg-sim-analytics
// -spec.md for what a fuller version would need (hand contents, mana
//   availability snapshots) that isn't captured yet.

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function asBoolean(v: unknown): boolean {
  return v === true;
}

export interface LifePoint {
  turn: number;
  life: number;
}

export interface PlayerGameStats {
  player: string;
  mulligans: number;
  landsPlayed: number;
  spellsCast: number;
  actionsTotal: number;
  firstSpellCastTurn: number | null;
  commanderCastTurns: number[];
  combatDamageTaken: number;
  nonCombatDamageTaken: number;
  lifeCurve: LifePoint[];
  eliminatedTurn: number | null;
  finalLife: number | null;
}

export interface GameStats {
  gameIndex: number;
  turnsPlayed: number;
  firstCombatDamageTurn: number | null;
  players: PlayerGameStats[];
}

function emptyPlayerStats(player: string): PlayerGameStats {
  return {
    player,
    mulligans: 0,
    landsPlayed: 0,
    spellsCast: 0,
    actionsTotal: 0,
    firstSpellCastTurn: null,
    commanderCastTurns: [],
    combatDamageTaken: 0,
    nonCombatDamageTaken: 0,
    lifeCurve: [],
    eliminatedTurn: null,
    finalLife: null,
  };
}

export function computeGameStats(
  gameIndex: number,
  events: AnalyticsEvent[],
  playerNames: string[],
  commandersByPlayer: Record<string, string[]> = {},
): GameStats {
  const perPlayer = new Map<string, PlayerGameStats>(playerNames.map((name) => [name, emptyPlayerStats(name)]));

  // Forge's own turn_began.turn counts every individual player's turn (P1's
  // turn is 1, P2's is 2, P3's is 3, P4's is 4, P1's second turn is 5, ...) -
  // not a round number. Convert to "round N" (one full lap of the table,
  // starting from whoever went first) by counting how many times that first
  // player's turn has come back around - anchored to the observed opening
  // player rather than a fixed /playerCount, so it stays correct even after
  // an elimination shrinks the rotation.
  let firstPlayer: string | null = null;
  let currentTurn = 0;
  let turnsPlayed = 0;
  let firstCombatDamageTurn: number | null = null;

  for (const event of events) {
    switch (event.type) {
      case "turn_began": {
        const turn = asNumber(event.turn);
        const player = asString(event.player);
        if (turn !== null) {
          if (firstPlayer === null) {
            firstPlayer = player;
            currentTurn = 1;
          } else if (player === firstPlayer) {
            currentTurn += 1;
          }
          turnsPlayed = Math.max(turnsPlayed, currentTurn);
        }
        break;
      }
      case "mulligan": {
        const stats = perPlayer.get(asString(event.player) ?? "");
        if (stats) stats.mulligans += 1;
        break;
      }
      case "land_played": {
        const stats = perPlayer.get(asString(event.player) ?? "");
        if (stats) stats.landsPlayed += 1;
        break;
      }
      case "spell_cast": {
        const player = asString(event.player);
        const stats = perPlayer.get(player ?? "");
        if (stats && asString(event.action) === "cast") {
          stats.spellsCast += 1;
          stats.actionsTotal += 1;
          if (stats.firstSpellCastTurn === null) stats.firstSpellCastTurn = currentTurn;
          const card = asString(event.card);
          const commanders = player ? commandersByPlayer[player] : undefined;
          if (card && commanders?.includes(card)) {
            stats.commanderCastTurns.push(currentTurn);
          }
        } else if (stats) {
          stats.actionsTotal += 1;
        }
        break;
      }
      case "life_change": {
        const stats = perPlayer.get(asString(event.player) ?? "");
        const newLife = asNumber(event.newLife);
        if (stats && newLife !== null) {
          stats.lifeCurve.push({ turn: currentTurn, life: newLife });
          stats.finalLife = newLife;
          if (newLife <= 0 && stats.eliminatedTurn === null) stats.eliminatedTurn = currentTurn;
        }
        break;
      }
      case "player_damaged": {
        const stats = perPlayer.get(asString(event.target) ?? "");
        const amount = asNumber(event.amount) ?? 0;
        const combat = asBoolean(event.combat);
        if (stats) {
          if (combat) stats.combatDamageTaken += amount;
          else stats.nonCombatDamageTaken += amount;
        }
        if (combat && firstCombatDamageTurn === null) firstCombatDamageTurn = currentTurn;
        break;
      }
      case "game_outcome": {
        // event.lastTurn is Forge's raw per-player-turn count, not a round
        // number - ignore it. turnsPlayed already reflects the latest round
        // from turn_began, which always precedes game_outcome in the stream.
        break;
      }
      default:
        break;
    }
  }

  return { gameIndex, turnsPlayed, firstCombatDamageTurn, players: [...perPlayer.values()] };
}

export interface DeckAggregateStats {
  player: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgMulligans: number;
  avgLandsPlayed: number;
  avgSpellsCast: number;
  avgFirstSpellCastTurn: number | null;
  avgCommanderCastTurn: number | null;
  avgEliminatedTurnWhenLost: number | null;
  /** Rough heuristic - see module doc comment. */
  manaIssueFlag: boolean;
  /** Rough 1-5 heuristic, community "power bracket" flavored - see module doc comment. */
  powerBracketEstimate: number;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeRunAggregateStats(
  games: Pick<AnalyzedGame, "gameIndex" | "winnerName" | "isDraw">[],
  gameStatsByIndex: Map<number, GameStats>,
  playerNames: string[],
): DeckAggregateStats[] {
  const results: DeckAggregateStats[] = [];

  // Pod-wide average lands-played, used as the baseline manaIssueFlag
  // compares each deck against - "below the pod" is the only meaningful
  // reference point we have without a larger cross-run sample.
  const allLandsPlayed = playerNames.flatMap((name) =>
    games.map((g) => gameStatsByIndex.get(g.gameIndex)?.players.find((p) => p.player === name)?.landsPlayed ?? 0),
  );
  const podAvgLandsPlayed = avg(allLandsPlayed) ?? 0;

  for (const player of playerNames) {
    const perGame = games.map((g) => ({
      game: g,
      stats: gameStatsByIndex.get(g.gameIndex)?.players.find((p) => p.player === player),
    }));

    const wins = games.filter((g) => !g.isDraw && g.winnerName === player).length;
    const winRate = games.length > 0 ? wins / games.length : 0;

    const mulligans = perGame.map(({ stats }) => stats?.mulligans ?? 0);
    const landsPlayed = perGame.map(({ stats }) => stats?.landsPlayed ?? 0);
    const spellsCast = perGame.map(({ stats }) => stats?.spellsCast ?? 0);
    const firstSpellCastTurns = perGame
      .map(({ stats }) => stats?.firstSpellCastTurn)
      .filter((t): t is number => t !== null && t !== undefined);
    const commanderCastTurns = perGame.flatMap(({ stats }) => stats?.commanderCastTurns ?? []);
    const eliminatedTurnsWhenLost = perGame
      .filter(({ game }) => game.winnerName !== player)
      .map(({ stats }) => stats?.eliminatedTurn)
      .filter((t): t is number => t !== null && t !== undefined);
    const winningGameTurns = perGame
      .filter(({ game }) => !game.isDraw && game.winnerName === player)
      .map(({ game }) => gameStatsByIndex.get(game.gameIndex)?.turnsPlayed)
      .filter((t): t is number => t !== null && t !== undefined);

    const avgMulligans = avg(mulligans) ?? 0;
    const avgLandsPlayed = avg(landsPlayed) ?? 0;
    const avgWinningGameTurn = avg(winningGameTurns);

    const manaIssueFlag =
      podAvgLandsPlayed > 0 && avgLandsPlayed < podAvgLandsPlayed * 0.8 && avgMulligans >= 0.5;

    // Deliberately simple: a 2.5 ("average pod") baseline, nudged by win
    // rate relative to a fair 1-in-4 share, how fast this deck's wins
    // close the game out, and opening-hand consistency. Meant as a rough,
    // fun signal - not a rigorous bracket rating.
    let bracket = 2.5;
    bracket += (winRate - 0.25) * 4;
    if (avgWinningGameTurn !== null) {
      if (avgWinningGameTurn <= 6) bracket += 1;
      else if (avgWinningGameTurn <= 10) bracket += 0.3;
      else if (avgWinningGameTurn >= 15) bracket -= 0.5;
    }
    if (avgMulligans <= 0.2) bracket += 0.3;
    else if (avgMulligans >= 1) bracket -= 0.3;
    bracket = Math.round(clamp(bracket, 1, 5) * 10) / 10;

    results.push({
      player,
      gamesPlayed: games.length,
      wins,
      winRate,
      avgMulligans,
      avgLandsPlayed,
      avgSpellsCast: avg(spellsCast) ?? 0,
      avgFirstSpellCastTurn: avg(firstSpellCastTurns),
      avgCommanderCastTurn: avg(commanderCastTurns),
      avgEliminatedTurnWhenLost: avg(eliminatedTurnsWhenLost),
      manaIssueFlag,
      powerBracketEstimate: bracket,
    });
  }

  return results;
}

export interface CardCastCount {
  card: string;
  count: number;
}

/**
 * How often each player actually cast each card, across every game in a
 * run - the direct answer to "does this card ever get cast at all?" (e.g.
 * a combo piece the AI keeps drawing but never uses). Only counts "cast"
 * spells (not triggered/activated abilities sharing the same event type),
 * so this tracks spells specifically, not permanents' abilities.
 *
 * Deliberately doesn't report a "never cast" list alongside this: that
 * needs the full decklist to diff against, and the parsed deck (see
 * importers/moxfieldText.ts's CardRef) doesn't carry card type - so lands
 * would flood such a list as false "never cast" spells. Worth adding once
 * there's a name -> card-type lookup available.
 */
export function computeCardCastCounts(
  games: Pick<AnalyzedGame, "analyticsEvents">[],
  playerNames: string[],
): Record<string, CardCastCount[]> {
  const counts = new Map<string, Map<string, number>>(playerNames.map((p) => [p, new Map<string, number>()]));

  for (const game of games) {
    for (const event of game.analyticsEvents ?? []) {
      if (event.type !== "spell_cast" || asString(event.action) !== "cast") continue;
      const player = asString(event.player);
      const card = asString(event.card);
      if (!player || !card) continue;
      const perPlayer = counts.get(player);
      if (!perPlayer) continue;
      perPlayer.set(card, (perPlayer.get(card) ?? 0) + 1);
    }
  }

  const result: Record<string, CardCastCount[]> = {};
  for (const [player, perPlayer] of counts) {
    result[player] = [...perPlayer.entries()]
      .map(([card, count]) => ({ card, count }))
      .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card));
  }
  return result;
}
