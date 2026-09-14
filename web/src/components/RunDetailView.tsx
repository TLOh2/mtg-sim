import { useEffect, useState } from "react";
import { api } from "../api";
import type { Award, CardCastCount, DeckAggregateStats, RunDetail, RunStats, SpellsByRoundPoint } from "../types";
import { ThreatMatrixTable } from "./ThreatMatrix";
import { StatusBadge, WinRateBar, shortName } from "./RunList";
import { HorizontalBarChart, LineChart, seriesColor } from "./Charts";

const POLL_MS = 4000;

/**
 * completedGames now updates in real time as each game actually finishes
 * (see server/src/simulate/forgeRunner.ts's incremental stdout scan) -
 * previously it stayed at 0 for the entire batch and jumped straight to
 * the final count once everything closed, which read as broken/frozen on
 * a long run. The animated sweep on top of the real fill exists for the
 * gaps between individual games finishing (each can take a minute or more)
 * so the page still visibly does something during that wait, not just
 * when a count ticks up.
 */
function SimulatingProgress({ completedGames, requestedGames }: { completedGames: number; requestedGames: number }) {
  const pct = requestedGames > 0 ? Math.min(100, Math.round((completedGames / requestedGames) * 100)) : 0;
  return (
    <div className="simulating-progress">
      <div className="simulating-progress-track">
        <div className="simulating-progress-fill" style={{ width: `${pct}%` }} />
        <div className="simulating-progress-sweep" />
      </div>
      <p className="muted">
        Simulating... {completedGames}/{requestedGames} games completed. This page updates automatically as each
        game finishes.
      </p>
    </div>
  );
}

export function RunDetailView({
  runId,
  onSelectGame,
  onBack,
  onRunStarted,
}: {
  runId: string;
  onSelectGame: (gameIndex: number) => void;
  onBack: () => void;
  onRunStarted: (runId: string) => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setRun(null);
    setStats(null);

    async function poll() {
      try {
        const result = await api.getRun(runId);
        if (cancelled) return;
        setRun(result);
        setError(null);
        // Keep polling while the run is still in progress; the batch is
        // analyzed as a whole, so the games table appears all at once when
        // status flips to "complete" rather than filling in game-by-game.
        if (result.status === "running") {
          timer = setTimeout(poll, POLL_MS);
        } else if (result.games.length > 0) {
          api
            .getStats(runId)
            .then((s) => !cancelled && setStats(s))
            .catch(() => {});
        }
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  async function handleCancel() {
    setActionError(null);
    setCancelling(true);
    try {
      await api.cancelRun(runId);
    } catch (err) {
      setActionError(String((err as Error).message ?? err));
    } finally {
      setCancelling(false);
    }
  }

  async function handleRestart() {
    if (!run?.deckSelections) return;
    setActionError(null);
    setRestarting(true);
    try {
      const { runId: newRunId } = await api.startRun(run.deckSelections, run.requestedGames, run.clockSeconds);
      onRunStarted(newRunId);
    } catch (err) {
      setActionError(String((err as Error).message ?? err));
      setRestarting(false);
    }
  }

  function handlePrint() {
    // The Cards cast section is collapsed by default (<details>), and a
    // closed <details> doesn't print its contents - force every one open
    // for the print, then put back however the user had them once the
    // print dialog closes (afterprint fires on both print and cancel).
    const detailsEls = Array.from(document.querySelectorAll<HTMLDetailsElement>(".cards-cast-details"));
    const wasOpen = detailsEls.map((d) => d.open);
    detailsEls.forEach((d) => (d.open = true));
    const restore = () => {
      detailsEls.forEach((d, i) => (d.open = wasOpen[i]));
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  if (error)
    return (
      <p className="error">
        Couldn't load run {runId}: {error}
      </p>
    );
  if (!run) return <p className="muted">Loading...</p>;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        &larr; All runs
      </button>
      <h2>
        {run.runId} <StatusBadge status={run.status} error={run.error} />
      </h2>
      <p className="muted">
        {run.completedGames}/{run.requestedGames} games completed &middot;{" "}
        {new Date(run.createdAt).toLocaleString()}
      </p>

      <div className="run-header-actions">
        {run.status === "running" && (
          <button type="button" className="danger" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling..." : "Cancel run"}
          </button>
        )}
        {run.deckSelections && (
          <button type="button" className="secondary" onClick={handleRestart} disabled={restarting}>
            {restarting ? "Starting..." : "Restart with same decks"}
          </button>
        )}
        {run.games.length > 0 && (
          <button type="button" className="secondary" onClick={handlePrint}>
            Download PDF report
          </button>
        )}
      </div>
      {actionError && <p className="error">{actionError}</p>}

      {run.status === "running" && (
        <SimulatingProgress completedGames={run.completedGames} requestedGames={run.requestedGames} />
      )}
      {run.status === "failed" && <p className="error">Run failed: {run.error}</p>}
      {run.status === "cancelled" && <p className="muted">Run was cancelled before it finished.</p>}

      {run.games.length > 0 && (
        <>
          <h3>Aggregate results</h3>
          <WinRateBar winsByPlayer={run.winsByPlayer} totalGames={run.completedGames} />

          {stats && stats.aggregate.length > 0 && (
            <DeckStatsSection
              aggregate={stats.aggregate}
              cardCastCounts={stats.cardCastCounts}
              neverCast={stats.neverCast}
              awards={stats.awards}
              threatMatrix={stats.threatMatrix}
              spellsByRound={stats.spellsByRound}
              spellsByRoundPerPlayer={stats.spellsByRoundPerPlayer}
              totalGames={run.completedGames}
            />
          )}

          <h3>Games</h3>
          <table className="run-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Result</th>
                <th>Duration</th>
                <th>Turning points</th>
              </tr>
            </thead>
            <tbody>
              {run.games.map((game) => (
                <tr key={game.gameIndex} onClick={() => onSelectGame(game.gameIndex)} className="clickable-row">
                  <td>{game.gameIndex}</td>
                  <td>{game.isDraw ? "Draw" : shortName(game.winnerName ?? "?")} won</td>
                  <td>{(game.durationMs / 1000).toFixed(1)}s</td>
                  <td>{game.turningPointCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function DeckStatsSection({
  aggregate,
  cardCastCounts,
  neverCast,
  awards,
  threatMatrix,
  spellsByRound,
  spellsByRoundPerPlayer,
  totalGames,
}: {
  aggregate: DeckAggregateStats[];
  cardCastCounts: Record<string, CardCastCount[]>;
  neverCast: Record<string, string[]>;
  awards: Award[];
  threatMatrix: Record<string, Record<string, number>>;
  spellsByRound: SpellsByRoundPoint[];
  spellsByRoundPerPlayer: Record<string, SpellsByRoundPoint[]>;
  totalGames: number;
}) {
  const winRateData = aggregate.map((a) => ({
    label: shortName(a.player),
    value: Math.round(a.winRate * 100),
  }));
  const totalDamageDealtData = aggregate.map((a) => ({
    label: shortName(a.player),
    value: Math.round((a.avgCombatDamageDealt + a.avgNonCombatDamageDealt) * 10) / 10,
  }));

  return (
    <>
      {awards.length > 0 && (
        <>
          <h3>Awards</h3>
          <p className="stats-caveat">
            Fun callouts from this run's own numbers, above - not a rigorous ranking, and a category is skipped
            entirely when nobody actually did the thing (e.g. no burn damage dealt, no snapshot data to judge
            consistency from).
          </p>
          <div className="awards-grid">
            {awards.map((award) => (
              <div className="award-card" key={award.id}>
                <div className="award-title">{award.title}</div>
                <div className="award-winner">{shortName(award.player)}</div>
                <div className="award-value">{award.value}</div>
                <div className="award-description">{award.description}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Win rate</h3>
      <HorizontalBarChart data={winRateData} valueFormatter={(v) => `${v}%`} />

      <h3>Deck diagnostics</h3>
      <p className="stats-caveat">
        Rough, best-effort estimates from {totalGames} game{totalGames === 1 ? "" : "s"} in this run - not a
        rigorous rating. See a deck's power bracket as "for fun/directional" rather than authoritative. Note: this
        is measured from simulated play, and Forge's AI doesn't plan multi-card combos (no lookahead beyond each
        card's own local heuristics) - a true combo deck will likely score lower here than its paper power level,
        since the AI can't actually pilot its game plan.
      </p>
      <table className="deck-stats-table">
        <thead>
          <tr>
            <th>Deck</th>
            <th>Avg. mulligans</th>
            <th>Avg. lands played</th>
            <th>Avg. first spell (turn)</th>
            <th>Avg. commander cast (turn)</th>
            <th title="1 = won or last one standing, on average across this run's games">Avg. finish pos.</th>
            <th>Bracket est.</th>
          </tr>
        </thead>
        <tbody>
          {aggregate.map((a) => (
            <tr key={a.player}>
              <td>
                {shortName(a.player)}
                {a.manaIssueFlag && (
                  <div className="mana-issue-flag" title="Averaging at least 1 missed land drop per game (a land sat in hand, unplayed) - see the Mana & Consistency section below for the detail.">
                    ⚠ possible mana issues
                  </div>
                )}
              </td>
              <td>{a.avgMulligans.toFixed(1)}</td>
              <td>{a.avgLandsPlayed.toFixed(1)}</td>
              <td>{a.avgFirstSpellCastTurn !== null ? a.avgFirstSpellCastTurn.toFixed(1) : "—"}</td>
              <td>{a.avgCommanderCastTurn !== null ? a.avgCommanderCastTurn.toFixed(1) : "—"}</td>
              <td>{a.avgFinishPosition !== null ? a.avgFinishPosition.toFixed(1) : "—"}</td>
              <td>
                <span className="bracket-pill">{a.powerBracketEstimate.toFixed(1)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {aggregate.some((a) => a.avgManaEfficiency !== null) && (
        <>
          <h3>Mana &amp; consistency</h3>
          <p className="stats-caveat">
            From per-turn hand/mana snapshots taken entering each player's own Main 2 - after that turn's own land
            drop and Main 1 spells, so "reaches N mana" reflects mana actually available that turn (see
            AnalyticsEventLogger.java) - older runs won't have this data. "Missed land drops" counts turns with a
            land sitting unplayed in
            hand. "Mana efficiency" is mana spent that turn / untapped lands available that turn, averaged - above
            1 means rocks/dorks are pulling weight beyond lands alone, below 1 means mana's going unused. "Curve
            efficiency" is a spell's mana value / the round it was cast in, averaged across every spell cast -
            above 1 means routinely landing above-curve spells (ramp paying off), below 1 means running behind
            curve.
          </p>
          <table className="deck-stats-table">
            <thead>
              <tr>
                <th>Deck</th>
                <th>Avg. missed land drops</th>
                <th>Avg. lands in hand (late game)</th>
                <th>Reaches 5 mana (turn)</th>
                <th>Reaches 7 mana (turn)</th>
                <th>Reaches 10 mana (turn)</th>
                <th>Mana efficiency</th>
                <th>Curve efficiency</th>
              </tr>
            </thead>
            <tbody>
              {aggregate.map((a) => (
                <tr key={a.player}>
                  <td>{shortName(a.player)}</td>
                  <td>{a.avgMissedLandDrops.toFixed(1)}</td>
                  <td>{a.avgLandsInHandAtEnd.toFixed(1)}</td>
                  <td>{a.avgManaThresholdTurns.five !== null ? a.avgManaThresholdTurns.five.toFixed(1) : "—"}</td>
                  <td>{a.avgManaThresholdTurns.seven !== null ? a.avgManaThresholdTurns.seven.toFixed(1) : "—"}</td>
                  <td>{a.avgManaThresholdTurns.ten !== null ? a.avgManaThresholdTurns.ten.toFixed(1) : "—"}</td>
                  <td>{a.avgManaEfficiency !== null ? a.avgManaEfficiency.toFixed(2) : "—"}</td>
                  <td>{a.avgCurveEfficiency !== null ? a.avgCurveEfficiency.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Damage dealt</h3>
      <p className="stats-caveat">
        Average total damage each deck dealt per game (combat + non-combat, e.g. burn spells like Chandra's
        Ignition), attributed by tracing each damage source card back to its owner (owners don't change hands in
        Magic, only control does) - so this is "who's actually doing the beating," not just who's taking it. The
        percentages below are each column's share of total offensive output - combat damage + non-combat damage +
        non-damage life loss combined - not just the two damage columns, so a deck that leans on life-loss effects
        (Sméagol-style) doesn't read as more combat-focused than it actually is.
      </p>
      <HorizontalBarChart data={totalDamageDealtData} valueFormatter={(v) => v.toFixed(1)} />
      <table className="deck-stats-table">
        <thead>
          <tr>
            <th>Deck</th>
            <th>Combat</th>
            <th>Non-combat</th>
            <th>Commander (of combat)</th>
            <th title="Not damage - a straight 'lose N life' effect or a cost like a fetch/pain land opponents pay. Never overlaps with the damage columns.">
              Non-damage life loss dealt
            </th>
          </tr>
        </thead>
        <tbody>
          {aggregate.map((a) => {
            const total = a.avgCombatDamageDealt + a.avgNonCombatDamageDealt + a.avgNonDamageLifeLossDealt;
            const combatPct = total > 0 ? Math.round((a.avgCombatDamageDealt / total) * 100) : null;
            const nonCombatPct = total > 0 ? Math.round((a.avgNonCombatDamageDealt / total) * 100) : null;
            const lifeLossPct = total > 0 ? Math.round((a.avgNonDamageLifeLossDealt / total) * 100) : null;
            return (
              <tr key={a.player}>
                <td>{shortName(a.player)}</td>
                <td>
                  {a.avgCombatDamageDealt.toFixed(1)}
                  {combatPct !== null && <span className="muted"> ({combatPct}%)</span>}
                </td>
                <td>
                  {a.avgNonCombatDamageDealt.toFixed(1)}
                  {nonCombatPct !== null && <span className="muted"> ({nonCombatPct}%)</span>}
                </td>
                <td>{a.avgCommanderDamageDealt > 0 ? a.avgCommanderDamageDealt.toFixed(1) : "—"}</td>
                <td>
                  {a.avgNonDamageLifeLossDealt > 0 ? a.avgNonDamageLifeLossDealt.toFixed(1) : "—"}
                  {lifeLossPct !== null && lifeLossPct > 0 && <span className="muted"> ({lifeLossPct}%)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Threat assessment</h3>
      <p className="stats-caveat">
        Total combat damage dealt from row to column, summed across {totalGames} game{totalGames === 1 ? "" : "s"} -
        who's actually attacking whom, not just who wins.
      </p>
      <ThreatMatrixTable matrix={threatMatrix} players={aggregate.map((a) => a.player)} />

      {spellsByRound.length > 0 && (
        <>
          <h3>Tempo: spells cast per round</h3>
          <p className="stats-caveat">
            Average spells cast per round, per deck, across {totalGames} game{totalGames === 1 ? "" : "s"} - when
            does each deck actually start doing things, and who's outpacing the table.
          </p>
          <LineChart
            series={aggregate.map((a, i) => ({
              label: shortName(a.player),
              color: seriesColor(i),
              points: (spellsByRoundPerPlayer[a.player] ?? []).map((p) => ({ x: p.round, y: p.count })),
            }))}
            yMin={0}
            xLabel="Round"
            yLabel="Avg. spells cast"
          />
        </>
      )}

      <h3>Cards cast</h3>
      <p className="stats-caveat">
        How often each deck actually cast each card across {totalGames} game{totalGames === 1 ? "" : "s"} - the
        direct answer to "does this combo piece ever get cast at all?" Only counts spells cast, not abilities
        activated/triggered off permanents already in play.
      </p>
      {aggregate.map((a) => (
        <details className="cards-cast-details" key={a.player}>
          <summary>
            {shortName(a.player)} ({(cardCastCounts[a.player] ?? []).length} unique card
            {(cardCastCounts[a.player] ?? []).length === 1 ? "" : "s"} cast)
          </summary>
          <div className="bar-chart">
            {(cardCastCounts[a.player] ?? []).map((c) => (
              <div className="bar-chart-row" key={c.card}>
                <span className="bar-chart-label" title={c.card}>
                  {c.card}
                </span>
                <span className="bar-chart-value">{c.count}</span>
              </div>
            ))}
            {(cardCastCounts[a.player] ?? []).length === 0 && (
              <p className="muted">No spells cast (or no analytics data - older run predating this feature).</p>
            )}
          </div>
        </details>
      ))}

      {Object.keys(neverCast).length > 0 && (
        <>
          <h3>Never cast</h3>
          <p className="stats-caveat">
            Nonland cards in each deck's actual decklist that never got cast across {totalGames} game
            {totalGames === 1 ? "" : "s"} - dead combo pieces, cards the AI kept drawing but never found a use
            for. Excludes the commander (tracked separately above) and lands (via Forge's own card database, not
            a name guess). Only available for runs started from a saved deck.
          </p>
          {aggregate
            .filter((a) => neverCast[a.player] !== undefined)
            .map((a) => (
              <details className="cards-cast-details" key={a.player}>
                <summary>
                  {shortName(a.player)} ({neverCast[a.player].length} never cast)
                </summary>
                <div className="bar-chart">
                  {neverCast[a.player].map((card) => (
                    <div className="bar-chart-row" key={card}>
                      <span className="bar-chart-label" title={card}>
                        {card}
                      </span>
                    </div>
                  ))}
                  {neverCast[a.player].length === 0 && <p className="muted">Every nonland card got cast at least once.</p>}
                </div>
              </details>
            ))}
        </>
      )}
    </>
  );
}
