import { useEffect, useState } from "react";
import { api } from "../api";
import type { CardCastCount, DeckAggregateStats, RunDetail, RunStats, SpellsByRoundPoint } from "../types";
import { ThreatMatrixTable } from "./ThreatMatrix";
import { StatusBadge, WinRateBar, shortName } from "./RunList";
import { HorizontalBarChart, LineChart } from "./Charts";

const POLL_MS = 4000;

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
      </div>
      {actionError && <p className="error">{actionError}</p>}

      {run.status === "running" && (
        <p className="muted">
          Simulating... this can take a while for a full batch. This page updates automatically, or come back
          later.
        </p>
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
              threatMatrix={stats.threatMatrix}
              spellsByRound={stats.spellsByRound}
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
  threatMatrix,
  spellsByRound,
  totalGames,
}: {
  aggregate: DeckAggregateStats[];
  cardCastCounts: Record<string, CardCastCount[]>;
  threatMatrix: Record<string, Record<string, number>>;
  spellsByRound: SpellsByRoundPoint[];
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
            From per-turn hand/mana snapshots taken entering each player's own Main 1 (see AnalyticsEventLogger.java)
            - older runs won't have this data. "Missed land drops" counts turns with a land sitting unplayed in
            hand. "Mana efficiency" is mana spent that turn / untapped lands available that turn, averaged - above
            1 means rocks/dorks are pulling weight beyond lands alone, below 1 means mana's going unused.
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
        Magic, only control does) - so this is "who's actually doing the beating," not just who's taking it.
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
            const total = a.avgCombatDamageDealt + a.avgNonCombatDamageDealt;
            const combatPct = total > 0 ? Math.round((a.avgCombatDamageDealt / total) * 100) : null;
            const nonCombatPct = total > 0 ? Math.round((a.avgNonCombatDamageDealt / total) * 100) : null;
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
                <td>{a.avgNonDamageLifeLossDealt > 0 ? a.avgNonDamageLifeLossDealt.toFixed(1) : "—"}</td>
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
            Total spells cast by anyone, pod-wide, summed across {totalGames} game{totalGames === 1 ? "" : "s"} -
            when does the table actually start doing things.
          </p>
          <LineChart
            series={[{ label: "Spells cast", points: spellsByRound.map((p) => ({ x: p.round, y: p.count })) }]}
            yMin={0}
            xLabel="Round"
            yLabel="Spells cast"
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
    </>
  );
}
