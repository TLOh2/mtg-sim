import { useState } from "react";
import { api } from "../api";
import { fetchMoxfieldDeckClientSide } from "../moxfieldClient";

export function NewRunForm({ onStarted, onCancel }: { onStarted: (runId: string) => void; onCancel: () => void }) {
  const [urls, setUrls] = useState(["", "", "", ""]);
  const [games, setGames] = useState(20);
  const [clockSeconds, setClockSeconds] = useState(180);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setUrl(i: number, value: string) {
    setUrls((prev) => prev.map((u, idx) => (idx === i ? value : u)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = urls.map((u) => u.trim());
    if (trimmed.some((u) => !u)) {
      setError("All 4 deck URLs are required.");
      return;
    }

    setSubmitting(true);
    try {
      // Fetched here, in your browser, rather than by the server - see
      // moxfieldClient.ts for why (the server gets blocked; a real browser
      // making this request doesn't look like a bot in the first place).
      setProgress("Fetching decks from Moxfield...");
      const decks = await Promise.all(
        trimmed.map(async (url, i) => {
          try {
            const raw = await fetchMoxfieldDeckClientSide(url);
            return { url, raw };
          } catch (err) {
            throw new Error(`Player ${i + 1} deck (${url}): ${(err as Error).message}`);
          }
        }),
      );

      setProgress("Starting simulation...");
      const { runId } = await api.startRun(decks, games, clockSeconds);
      onStarted(runId);
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <form className="new-run-form" onSubmit={handleSubmit}>
      <h3>New run</h3>
      <p className="muted">
        Paste 4 Moxfield deck URLs (e.g. https://moxfield.com/decks/&lt;id&gt;) to simulate a pod. A full
        batch can take a while to run - you can navigate away and check back later.
      </p>

      {urls.map((url, i) => (
        <label key={i} className="deck-url-field">
          Player {i + 1}
          <input
            type="url"
            required
            placeholder="https://moxfield.com/decks/..."
            value={url}
            onChange={(e) => setUrl(i, e.target.value)}
            disabled={submitting}
          />
        </label>
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
      {progress && !error && <p className="muted">{progress}</p>}

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
