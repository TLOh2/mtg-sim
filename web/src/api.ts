import type { GameDetail, RunDetail, RunListEntry, StartRunResponse } from "./types";

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
  startRun: (decks: { label: string; decklistText: string }[], games?: number, clockSeconds?: number) =>
    postJson<StartRunResponse>("/api/runs", { decks, games, clockSeconds }),
};
