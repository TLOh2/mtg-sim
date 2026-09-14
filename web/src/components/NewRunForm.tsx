import { useEffect, useState } from "react";
import { api } from "../api";
import type { DeckLibraryEntry, DeckSelection } from "../types";

interface SlotState {
  deckId: string; // "" means "paste new" for this slot
  label: string;
  decklistText: string;
}

const emptySlot = (): SlotState => ({ deckId: "", label: "", decklistText: "" });

export function NewRunForm({ onStarted, onCancel }: { onStarted: (runId: string) => void; onCancel: () => void }) {
  const [decks, setDecks] = useState<DeckLibraryEntry[] | null>(null);
  const [slots, setSlots] = useState<SlotState[]>([emptySlot(), emptySlot(), emptySlot(), emptySlot()]);
  const [games, setGames] = useState(20);
  const [clockSeconds, setClockSeconds] = useState(180);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listDecks().then(setDecks).catch(() => setDecks([]));
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
      const { runId } = await api.startRun(decksPayload, games, clockSeconds);
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
        Pick a saved deck for each player, or choose <strong>Paste new...</strong> and paste a Moxfield
        decklist (Export &rarr; <strong>Copy for Moxfield</strong> - not Arena/MTGO, those drop cards). A deck
        you paste here gets saved automatically, so you won't need to paste it again next time.
      </p>

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
