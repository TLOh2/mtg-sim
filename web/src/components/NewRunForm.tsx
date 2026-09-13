import { useState } from "react";
import { api } from "../api";

export function NewRunForm({ onStarted, onCancel }: { onStarted: (runId: string) => void; onCancel: () => void }) {
  const [labels, setLabels] = useState(["", "", "", ""]);
  const [decklists, setDecklists] = useState(["", "", "", ""]);
  const [games, setGames] = useState(20);
  const [clockSeconds, setClockSeconds] = useState(180);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLabel(i: number, value: string) {
    setLabels((prev) => prev.map((l, idx) => (idx === i ? value : l)));
  }
  function setDecklist(i: number, value: string) {
    setDecklists((prev) => prev.map((d, idx) => (idx === i ? value : d)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = decklists.map((d) => d.trim());
    if (trimmed.some((d) => !d)) {
      setError("All 4 decklists are required.");
      return;
    }

    setSubmitting(true);
    try {
      const decks = trimmed.map((decklistText, i) => ({
        label: labels[i].trim() || `Player ${i + 1}`,
        decklistText,
      }));
      const { runId } = await api.startRun(decks, games, clockSeconds);
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
        On each Moxfield deck's page, open <strong>Export</strong> and click <strong>Copy for Moxfield</strong>{" "}
        (not "Copy for Arena"/"Copy for MTGO" - those drop cards those formats can't represent). Paste the result
        below, one per player. A full batch can take a while to run - you can navigate away and check back later.
      </p>

      {decklists.map((decklistText, i) => (
        <div key={i} className="deck-input-field">
          <label className="deck-label-row">
            Player {i + 1}
            <input
              type="text"
              placeholder="optional name, e.g. deck title"
              value={labels[i]}
              onChange={(e) => setLabel(i, e.target.value)}
              disabled={submitting}
            />
          </label>
          <textarea
            required
            rows={5}
            placeholder={"1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301\n..."}
            value={decklistText}
            onChange={(e) => setDecklist(i, e.target.value)}
            disabled={submitting}
          />
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
