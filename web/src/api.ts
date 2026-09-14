import type {
  DeckLibraryEntry,
  DeckSelection,
  GameDetail,
  RunDetail,
  RunListEntry,
  RunStats,
  StartRunResponse,
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((payload && payload.error) || `${path} -> HTTP ${res.status}`);
  }
  return payload as T;
}

export const api = {
  listRuns: () => getJson<RunListEntry[]>("/api/runs"),
  getRun: (runId: string) => getJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`),
  getGame: (runId: string, gameIndex: number) =>
    getJson<GameDetail>(`/api/runs/${encodeURIComponent(runId)}/games/${gameIndex}`),
  getStats: (runId: string) => getJson<RunStats>(`/api/runs/${encodeURIComponent(runId)}/stats`),
  startRun: (decks: DeckSelection[], games?: number, clockSeconds?: number) =>
    postJson<StartRunResponse>("/api/runs", { decks, games, clockSeconds }),
  cancelRun: (runId: string) => postJson<{ cancelled: boolean }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {}),
  listDecks: () => getJson<DeckLibraryEntry[]>("/api/decks"),
};
