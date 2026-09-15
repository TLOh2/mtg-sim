import { useEffect, useState } from "react";
import { api } from "../api";
import { AI_PROFILE_DESCRIPTIONS, AI_PROFILES } from "../types";
import type { DeckLibraryEntry, DeckSelection, GameDurationStats } from "../types";

interface SlotState {
  deckId: string; // "" means "paste new" for this slot
  label: string;
  decklistText: string;
  aiProfile: string;
}

const emptySlot = (): SlotState => ({ deckId: "", label: "", decklistText: "", aiProfile: "Default" });

// Used only when there's no history yet to estimate from (computed from
// what we've actually observed in testing: games routinely finish well
// under the clock) - clearly labeled as a guess in the UI, not shown as if
// it were measured.
const DEFAULT_FRACTION_OF_CLOCK = 0.3;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `~${hours}h${rest > 0 ? ` ${rest}m` : ""}`;
}

export function NewRunForm({ onStarted, onCancel }: { onStarted: (runId: string) => void; onCancel: () => void }) {
  const [decks, setDecks] = useState<DeckLibraryEntry[] | null>(null);
  const [slots, setSlots] = useState<SlotState[]>([emptySlot(), emptySlot(), emptySlot(), emptySlot()]);
  const [games, setGames] = useState(20);
  const [clockSeconds, setClockSeconds] = useState(180);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durationStats, setDurationStats] = useState<GameDurationStats | null>(null);

  useEffect(() => {
    api.listDecks().then(setDecks).catch(() => setDecks([]));
    api.getGameDurationStats().then(setDurationStats).catch(() => setDurationStats(null));
  }, []);

  function updateSlot(i: number, patch: Partial<SlotState>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    for (const [i, slot] of slots.entries()) {
      if (!slot.deckId && !slot.decklistText.trim()) {
        setError(`Player ${i + 1}: pick a saved deck or paste a decklist.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const decksPayload: DeckSelection[] = slots.map((slot, i) =>
        slot.deckId
          ? { deckId: slot.deckId }
          : { label: slot.label.trim() || `Player ${i + 1}`, decklistText: slot.decklistText.trim() },
      );
      const aiProfiles = slots.map((slot) => slot.aiProfile);
      const { runId } = await api.startRun(decksPayload, games, clockSeconds, aiProfiles);
      onStarted(runId);
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setSubmitting(false);
    }
  }

  return (
    <form className="new-run-form" onSubmit={handleSubmit}>
      <h3>New run</h3>
      <p className="muted">
        Pick a saved deck for each player, or choose <strong>Paste new...</strong> and paste a decklist. A
        deck you paste here gets saved automatically, so you won't need to paste it again next time.
      </p>
      <details className="paste-format-help">
        <summary>What should I paste?</summary>
        <p>
          <strong>Moxfield:</strong> on the deck page, click <strong>Export</strong> &rarr;{" "}
          <strong>Copy for Moxfield</strong> (not Arena/MTGO - those drop cards).
        </p>
        <p>
          <strong>Archidekt:</strong> on the deck page, click <strong>More</strong> &rarr;{" "}
          <strong>Export deck</strong> &rarr; <strong>Copy</strong> (the default "Text" export works as-is -
          no settings to change).
        </p>
        <p>
          <strong>TappedOut:</strong> on the deck page, click <strong>Actions</strong> &rarr;{" "}
          <strong>Download / Export / Embed Code</strong>, pick <strong>CSV</strong> from the dropdown, then
          copy the result (TappedOut's plain "Text" export doesn't mark which card is the commander, so CSV
          is the one that actually works here).
        </p>
        <p className="muted">All three formats are auto-detected, so there's no need to say which one it is.</p>
      </details>

      {slots.map((slot, i) => (
        <div key={i} className="deck-input-field">
          <label className="deck-label-row">
            Player {i + 1}
            <select
              value={slot.deckId}
              onChange={(e) => updateSlot(i, { deckId: e.target.value })}
              disabled={submitting || !decks}
            >
              <option value="">Paste new...</option>
              {decks?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                  {d.commanderPreview ? ` (${d.commanderPreview})` : ""}
                </option>
              ))}
            </select>
          </label>

          {!slot.deckId && (
            <>
              <input
                type="text"
                placeholder="name this deck (optional)"
                value={slot.label}
                onChange={(e) => updateSlot(i, { label: e.target.value })}
                disabled={submitting}
              />
              <textarea
                rows={5}
                placeholder={"1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301\n..."}
                value={slot.decklistText}
                onChange={(e) => updateSlot(i, { decklistText: e.target.value })}
                disabled={submitting}
              />
            </>
          )}

          <label className="deck-label-row" title={AI_PROFILE_DESCRIPTIONS[slot.aiProfile as keyof typeof AI_PROFILE_DESCRIPTIONS]}>
            AI profile
            <select
              value={slot.aiProfile}
              onChange={(e) => updateSlot(i, { aiProfile: e.target.value })}
              disabled={submitting}
            >
              {AI_PROFILES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}

      <div className="new-run-options">
        <label>
          Games
          <input
            type="number"
            min={1}
            max={200}
            value={games}
            onChange={(e) => setGames(Number(e.target.value))}
            disabled={submitting}
          />
        </label>
        <label>
          Clock (seconds/game)
          <input
            type="number"
            min={30}
            max={1800}
            value={clockSeconds}
            onChange={(e) => setClockSeconds(Number(e.target.value))}
            disabled={submitting}
          />
        </label>
      </div>

      <p className="stats-caveat">
        {(() => {
          const worstCaseSeconds = games * clockSeconds;
          const fraction = durationStats?.avgFractionOfClock ?? DEFAULT_FRACTION_OF_CLOCK;
          const typicalSeconds = worstCaseSeconds * fraction;
          const basis =
            durationStats && durationStats.sampleSize > 0
              ? `based on ${durationStats.sampleSize} past game${durationStats.sampleSize === 1 ? "" : "s"}`
              : "a rough guess - no past games yet to base this on";
          return (
            <>
              Estimated time: {formatDuration(typicalSeconds)} typical ({basis}), up to{" "}
              {formatDuration(worstCaseSeconds)} worst case if every game ran the full clock.
            </>
          );
        })()}
      </p>

      {error && <p className="error">{error}</p>}

      <div className="new-run-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Starting..." : "Start run"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
