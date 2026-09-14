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

export interface TurnSnapshot {
  turn: number;
  handSize: number;
  landsInHand: number;
  landsInPlay: number;
  untappedLands: number;
}

export interface ManaThresholdTurns {
  five: number | null;
  seven: number | null;
  ten: number | null;
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
  /** Combat + non-combat damage this player's own cards dealt to anyone - see the ownerOf note on computeGameStats for how "dealt by" is attributed. */
  combatDamageDealt: number;
  nonCombatDamageDealt: number;
  /** Subset of combatDamageDealt where the source card was this player's own commander. */
  commanderDamageDealt: number;
  /** Life an opponent lost to this player's non-damage effects (fetch/pain-land costs and Reanimate-style self-costs are excluded - only counts life loss inflicted on someone else). Not damage, so it never triggers damage-prevention/redirection and doesn't overlap with combat/non-combat damage above. */
  nonDamageLifeLossDealt: number;
  firstCombatDamageDealtTurn: number | null;
  lifeCurve: LifePoint[];
  eliminatedTurn: number | null;
  finalLife: number | null;
  /** One per turn_snapshot event (entering this player's own Main 1) - see AnalyticsEventLogger.java. */
  turnSnapshots: TurnSnapshot[];
  /** Turns where they had a land in hand at the start of their main phase but didn't play one that turn. */
  missedLandDropTurns: number[];
  /** First turn each untapped-lands threshold was reached, from turnSnapshots. */
  manaThresholdTurns: ManaThresholdTurns;
  /** Average of (mana value of spells cast that turn / untapped lands available that turn) across turns with >0 available mana - >1 means spending more than lands alone provide (rocks/dorks helping), <1 means leaving mana up. */
  avgManaEfficiency: number | null;
  /** Average of (a spell's mana value / the round it was cast in) across every spell cast - "curve efficiency" in the deckbuilding sense: >1 means routinely casting spells above what their round "should" support (ramp working), ~1 means playing roughly on-curve, <1 means running behind curve (screwed, or just holding up mana). Round 0 (pre-game/mulligan actions) is excluded to avoid a divide-by-zero. */
  avgCurveEfficiency: number | null;
}

export interface EliminationEvent {
  player: string;
  turn: number;
}

export interface GameStats {
  gameIndex: number;
  turnsPlayed: number;
  firstCombatDamageTurn: number | null;
  eliminationOrder: EliminationEvent[];
  /** attacker -> defender -> total combat damage dealt this game. Only entries with damage > 0 are present. */
  threatMatrix: Record<string, Record<string, number>>;
  /** round number -> total spells cast by anyone that round - pod-wide tempo, not per-deck. */
  spellsByRound: Record<number, number>;
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
    combatDamageDealt: 0,
    nonCombatDamageDealt: 0,
    commanderDamageDealt: 0,
    nonDamageLifeLossDealt: 0,
    firstCombatDamageDealtTurn: null,
    lifeCurve: [],
    eliminatedTurn: null,
    finalLife: null,
    turnSnapshots: [],
    missedLandDropTurns: [],
    manaThresholdTurns: { five: null, seven: null, ten: null },
    avgManaEfficiency: null,
    avgCurveEfficiency: null,
  };
}

/**
 * Adds n to map[a][b], creating either level as needed.
 */
function addToMatrix(matrix: Map<string, Map<string, number>>, a: string, b: string, n: number): void {
  if (!matrix.has(a)) matrix.set(a, new Map());
  const row = matrix.get(a)!;
  row.set(b, (row.get(b) ?? 0) + n);
}

function matrixToRecord(matrix: Map<string, Map<string, number>>): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [a, row] of matrix) {
    result[a] = Object.fromEntries(row);
  }
  return result;
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
  const eliminationOrder: EliminationEvent[] = [];
  const threatMatrix = new Map<string, Map<string, number>>();
  const spellsByRound = new Map<number, number>();

  // A card's owner never changes in Magic (only its controller can, under
  // theft effects) - so the first zone_change we see naming a card's owner
  // is good for the rest of the game. This lets player_damaged (which only
  // names the source *card*, not a player) be attributed to whoever actually
  // controls the source of the damage for "who dealt this" stats. Imperfect
  // only for cards sharing an exact name across two different players' decks
  // (e.g. both running a basic Mountain), which is rare for nonland threats.
  const ownerOf = new Map<string, string>();

  // Keyed by `${player}#${turn}` - land_played fires exactly when a land is
  // played, so this just needs to remember "yes" for that turn; manaSpent is
  // an accumulator since a turn can have several spells.
  const landPlayedTurns = new Set<string>();
  const manaSpentByTurn = new Map<string, number>();
  const turnKey = (player: string, turn: number) => `${player}#${turn}`;

  // Per-spell (manaValue / round cast) ratios, one list per player - the raw
  // material for avgCurveEfficiency, averaged once every event's been seen.
  const curveEfficiencySamples = new Map<string, number[]>();

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
        const player = asString(event.player);
        const stats = perPlayer.get(player ?? "");
        if (stats) stats.landsPlayed += 1;
        if (player) landPlayedTurns.add(turnKey(player, currentTurn));
        const card = asString(event.card);
        if (card && player && !ownerOf.has(card)) ownerOf.set(card, player);
        break;
      }
      case "zone_change": {
        const card = asString(event.card);
        const owner = asString(event.owner);
        if (card && owner && !ownerOf.has(card)) ownerOf.set(card, owner);
        break;
      }
      case "spell_cast": {
        const player = asString(event.player);
        const stats = perPlayer.get(player ?? "");
        if (stats && asString(event.action) === "cast") {
          stats.spellsCast += 1;
          stats.actionsTotal += 1;
          spellsByRound.set(currentTurn, (spellsByRound.get(currentTurn) ?? 0) + 1);
          if (stats.firstSpellCastTurn === null) stats.firstSpellCastTurn = currentTurn;
          const card = asString(event.card);
          const commanders = player ? commandersByPlayer[player] : undefined;
          if (card && commanders?.includes(card)) {
            stats.commanderCastTurns.push(currentTurn);
          }
          const manaValue = asNumber(event.manaValue);
          if (player && manaValue !== null) {
            const key = turnKey(player, currentTurn);
            manaSpentByTurn.set(key, (manaSpentByTurn.get(key) ?? 0) + manaValue);
            if (currentTurn > 0) {
              if (!curveEfficiencySamples.has(player)) curveEfficiencySamples.set(player, []);
              curveEfficiencySamples.get(player)!.push(manaValue / currentTurn);
            }
          }
        } else if (stats) {
          stats.actionsTotal += 1;
        }
        break;
      }
      case "turn_snapshot": {
        const player = asString(event.player);
        const stats = perPlayer.get(player ?? "");
        const handSize = asNumber(event.handSize);
        const landsInHand = asNumber(event.landsInHand);
        const landsInPlay = asNumber(event.landsInPlay);
        const untappedLands = asNumber(event.untappedLands);
        if (stats && handSize !== null && landsInHand !== null && landsInPlay !== null && untappedLands !== null) {
          stats.turnSnapshots.push({ turn: currentTurn, handSize, landsInHand, landsInPlay, untappedLands });
        }
        break;
      }
      case "life_change": {
        const player = asString(event.player);
        const stats = perPlayer.get(player ?? "");
        const oldLife = asNumber(event.oldLife);
        const newLife = asNumber(event.newLife);
        if (stats && newLife !== null) {
          stats.lifeCurve.push({ turn: currentTurn, life: newLife });
          stats.finalLife = newLife;
          if (newLife <= 0 && stats.eliminatedTurn === null) {
            stats.eliminatedTurn = currentTurn;
            if (player) eliminationOrder.push({ player, turn: currentTurn });
          }
        }

        // Non-damage life loss (a straight "lose N life" effect, or a cost
        // like a fetch/pain land) inflicted on someone ELSE - self-costs are
        // excluded by the dealer!==player check, same as the damage-dealt
        // logic below. Damage-driven life loss is already fully covered via
        // player_damaged, so isDamage:true here is deliberately skipped to
        // avoid double-counting the same life total change twice.
        if (!asBoolean(event.isDamage) && oldLife !== null && newLife !== null && newLife < oldLife) {
          const source = asString(event.source);
          const dealer = source ? ownerOf.get(source) : undefined;
          if (dealer && player && dealer !== player) {
            const dealerStats = perPlayer.get(dealer);
            if (dealerStats) dealerStats.nonDamageLifeLossDealt += oldLife - newLife;
          }
        }
        break;
      }
      case "player_damaged": {
        const target = asString(event.target);
        const stats = perPlayer.get(target ?? "");
        const amount = asNumber(event.amount) ?? 0;
        const combat = asBoolean(event.combat);
        if (stats) {
          if (combat) stats.combatDamageTaken += amount;
          else stats.nonCombatDamageTaken += amount;
        }
        if (combat && firstCombatDamageTurn === null) firstCombatDamageTurn = currentTurn;

        const source = asString(event.source);
        const dealer = source ? ownerOf.get(source) : undefined;
        if (dealer) {
          const dealerStats = perPlayer.get(dealer);
          if (dealerStats) {
            if (combat) {
              dealerStats.combatDamageDealt += amount;
              if (dealerStats.firstCombatDamageDealtTurn === null) {
                dealerStats.firstCombatDamageDealtTurn = currentTurn;
              }
              const commanders = commandersByPlayer[dealer];
              if (source && commanders?.includes(source)) {
                dealerStats.commanderDamageDealt += amount;
              }
            } else {
              dealerStats.nonCombatDamageDealt += amount;
            }
          }
          if (target && dealer !== target && combat && amount > 0) {
            addToMatrix(threatMatrix, dealer, target, amount);
          }
        }
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

  // Derive the snapshot-dependent stats now that every turn_snapshot,
  // land_played, and spell_cast for the game has been seen.
  for (const stats of perPlayer.values()) {
    const efficiencies: number[] = [];
    for (const snap of stats.turnSnapshots) {
      if (snap.landsInHand > 0 && !landPlayedTurns.has(turnKey(stats.player, snap.turn))) {
        stats.missedLandDropTurns.push(snap.turn);
      }
      if (stats.manaThresholdTurns.five === null && snap.untappedLands >= 5) {
        stats.manaThresholdTurns.five = snap.turn;
      }
      if (stats.manaThresholdTurns.seven === null && snap.untappedLands >= 7) {
        stats.manaThresholdTurns.seven = snap.turn;
      }
      if (stats.manaThresholdTurns.ten === null && snap.untappedLands >= 10) {
        stats.manaThresholdTurns.ten = snap.turn;
      }
      if (snap.untappedLands > 0) {
        const spent = manaSpentByTurn.get(turnKey(stats.player, snap.turn)) ?? 0;
        efficiencies.push(spent / snap.untappedLands);
      }
    }
    stats.avgManaEfficiency = avg(efficiencies);
    stats.avgCurveEfficiency = avg(curveEfficiencySamples.get(stats.player) ?? []);
  }

  return {
    gameIndex,
    turnsPlayed,
    firstCombatDamageTurn,
    eliminationOrder,
    threatMatrix: matrixToRecord(threatMatrix),
    spellsByRound: Object.fromEntries(spellsByRound),
    players: [...perPlayer.values()],
  };
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
  avgCombatDamageDealt: number;
  avgNonCombatDamageDealt: number;
  avgCommanderDamageDealt: number;
  /** Non-damage life loss inflicted on opponents (fetch/pain-land self-costs excluded) - see PlayerGameStats.nonDamageLifeLossDealt. Not damage, so it's reported separately from the combat/non-combat totals above rather than folded in. */
  avgNonDamageLifeLossDealt: number;
  avgFirstCombatDamageDealtTurn: number | null;
  /** Average turnsPlayed across just the games this deck actually won (null if it hasn't won any) - "how fast does this deck close a game out when it wins," not to be confused with avgFirstCombatDamageDealtTurn (when it starts pressuring, not when it finishes). */
  avgWinningGameTurn: number | null;
  /** 1 (won or last one standing) through however many players were in the pod - see computeFinishPosition. */
  avgFinishPosition: number | null;
  /** Average count of turns per game where a land sat unplayed in hand - "screw" if this AND avgLandsInHandAtEnd are both low, "flood" if both are high. */
  avgMissedLandDrops: number;
  /** Average landsInHand from the last turn_snapshot of each game - a rough proxy for "lands in hand at end of game" (technically "at their last main phase", not literally the final turn of the game). */
  avgLandsInHandAtEnd: number;
  /** First turn each untapped-lands threshold was reached, averaged across games that reached it at all (null if never reached in any game). */
  avgManaThresholdTurns: { five: number | null; seven: number | null; ten: number | null };
  /** >1 = spending more mana than untapped lands alone provide (rocks/dorks pulling weight), <1 = leaving mana up, ~1 = using lands at face value. */
  avgManaEfficiency: number | null;
  /** >1 = routinely casting above-curve spells for the round (ramp working), ~1 = on-curve, <1 = behind curve - see PlayerGameStats.avgCurveEfficiency. */
  avgCurveEfficiency: number | null;
  /** Rough heuristic - see module doc comment. */
  manaIssueFlag: boolean;
  /** Rough 1-5 heuristic, community "power bracket" flavored - see module doc comment. */
  powerBracketEstimate: number;
}

/**
 * Ranks players 1 (best) through N for one game: the winner (or every
 * still-alive player, tied, on a draw) takes 1st; everyone else is ordered
 * by elimination turn descending (eliminated latest = better finish).
 * A player who somehow neither won nor appears in eliminationOrder (the
 * game hit its clock with them still alive) ranks just behind the winner,
 * ordered by final life among any others in the same situation.
 */
function computeFinishPosition(
  winnerName: string | null,
  isDraw: boolean,
  eliminationOrder: EliminationEvent[],
  players: PlayerGameStats[],
): Record<string, number> {
  const eliminatedTurnByPlayer = new Map(eliminationOrder.map((e) => [e.player, e.turn]));
  const result: Record<string, number> = {};

  const survivors = players
    .map((p) => p.player)
    .filter((p) => !eliminatedTurnByPlayer.has(p))
    .sort((a, b) => {
      if (isDraw) return 0;
      if (a === winnerName) return -1;
      if (b === winnerName) return 1;
      const lifeA = players.find((p) => p.player === a)?.finalLife ?? 0;
      const lifeB = players.find((p) => p.player === b)?.finalLife ?? 0;
      return lifeB - lifeA;
    });

  let rank = 1;
  for (const player of survivors) {
    result[player] = isDraw || survivors.length === 1 ? 1 : rank;
    rank++;
  }

  const eliminatedDescending = [...eliminationOrder].sort((a, b) => b.turn - a.turn);
  for (const { player } of eliminatedDescending) {
    result[player] = rank;
    rank++;
  }

  return result;
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

  const finishPositionByGame = new Map<number, Record<string, number>>();
  for (const g of games) {
    const gs = gameStatsByIndex.get(g.gameIndex);
    if (gs) {
      finishPositionByGame.set(
        g.gameIndex,
        computeFinishPosition(g.winnerName, g.isDraw, gs.eliminationOrder, gs.players),
      );
    }
  }

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
    const combatDamageDealt = perGame.map(({ stats }) => stats?.combatDamageDealt ?? 0);
    const nonCombatDamageDealt = perGame.map(({ stats }) => stats?.nonCombatDamageDealt ?? 0);
    const commanderDamageDealt = perGame.map(({ stats }) => stats?.commanderDamageDealt ?? 0);
    const nonDamageLifeLossDealt = perGame.map(({ stats }) => stats?.nonDamageLifeLossDealt ?? 0);
    const firstCombatDamageDealtTurns = perGame
      .map(({ stats }) => stats?.firstCombatDamageDealtTurn)
      .filter((t): t is number => t !== null && t !== undefined);
    const finishPositions = games
      .map((g) => finishPositionByGame.get(g.gameIndex)?.[player])
      .filter((p): p is number => p !== undefined);
    const missedLandDrops = perGame.map(({ stats }) => stats?.missedLandDropTurns.length ?? 0);
    const landsInHandAtEnd = perGame
      .map(({ stats }) => stats?.turnSnapshots.at(-1)?.landsInHand)
      .filter((n): n is number => n !== null && n !== undefined);
    const manaEfficiencies = perGame
      .map(({ stats }) => stats?.avgManaEfficiency)
      .filter((n): n is number => n !== null && n !== undefined);
    const curveEfficiencies = perGame
      .map(({ stats }) => stats?.avgCurveEfficiency)
      .filter((n): n is number => n !== null && n !== undefined);
    const fiveTurns = perGame
      .map(({ stats }) => stats?.manaThresholdTurns.five)
      .filter((n): n is number => n !== null && n !== undefined);
    const sevenTurns = perGame
      .map(({ stats }) => stats?.manaThresholdTurns.seven)
      .filter((n): n is number => n !== null && n !== undefined);
    const tenTurns = perGame
      .map(({ stats }) => stats?.manaThresholdTurns.ten)
      .filter((n): n is number => n !== null && n !== undefined);

    const avgMulligans = avg(mulligans) ?? 0;
    const avgLandsPlayed = avg(landsPlayed) ?? 0;
    const avgWinningGameTurn = avg(winningGameTurns);
    const avgMissedLandDropsForFlag = avg(missedLandDrops) ?? 0;

    // Real missed-land-drop turns (from turn_snapshot - see
    // AnalyticsEventLogger.java) are a direct signal, so prefer them when
    // present (any game with a turn_snapshot). Older runs that predate that
    // event fall back to the indirect "plays fewer lands than the pod, and
    // mulligans a lot" heuristic.
    const hasSnapshotData = perGame.some(({ stats }) => (stats?.turnSnapshots.length ?? 0) > 0);
    const manaIssueFlag = hasSnapshotData
      ? avgMissedLandDropsForFlag >= 1
      : podAvgLandsPlayed > 0 && avgLandsPlayed < podAvgLandsPlayed * 0.8 && avgMulligans >= 0.5;

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
      avgCombatDamageDealt: avg(combatDamageDealt) ?? 0,
      avgNonCombatDamageDealt: avg(nonCombatDamageDealt) ?? 0,
      avgCommanderDamageDealt: avg(commanderDamageDealt) ?? 0,
      avgNonDamageLifeLossDealt: avg(nonDamageLifeLossDealt) ?? 0,
      avgFirstCombatDamageDealtTurn: avg(firstCombatDamageDealtTurns),
      avgWinningGameTurn,
      avgFinishPosition: avg(finishPositions),
      avgMissedLandDrops: avg(missedLandDrops) ?? 0,
      avgLandsInHandAtEnd: avg(landsInHandAtEnd) ?? 0,
      avgManaThresholdTurns: {
        five: avg(fiveTurns),
        seven: avg(sevenTurns),
        ten: avg(tenTurns),
      },
      avgManaEfficiency: avg(manaEfficiencies),
      avgCurveEfficiency: avg(curveEfficiencies),
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

/**
 * "Threat assessment": total combat damage dealt from each player to each
 * other player, summed across every game in a run - who's actually
 * attacking whom, not just who wins. See computeGameStats's ownerOf note for
 * how damage gets attributed to a dealer in the first place.
 */
export function computeRunThreatMatrix(gameStatsList: GameStats[]): Record<string, Record<string, number>> {
  const matrix = new Map<string, Map<string, number>>();
  for (const gs of gameStatsList) {
    for (const [attacker, row] of Object.entries(gs.threatMatrix)) {
      for (const [defender, amount] of Object.entries(row)) {
        addToMatrix(matrix, attacker, defender, amount);
      }
    }
  }
  return matrixToRecord(matrix);
}

export interface SpellsByRoundPoint {
  round: number;
  count: number;
}

/**
 * Pod-wide tempo: total spells cast in each round, summed across every game
 * in the run (raw totals, not averaged per game - "how busy does round N
 * tend to get" reads fine either way for a quick tempo chart).
 */
export function computeRunSpellsByRound(gameStatsList: GameStats[]): SpellsByRoundPoint[] {
  const totals = new Map<number, number>();
  for (const gs of gameStatsList) {
    for (const [round, count] of Object.entries(gs.spellsByRound)) {
      const r = Number(round);
      totals.set(r, (totals.get(r) ?? 0) + count);
    }
  }
  return [...totals.entries()]
    .filter(([round]) => round > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([round, count]) => ({ round, count }));
}
