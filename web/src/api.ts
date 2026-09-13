import type { GameDetail, RunDetail, RunListEntry } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  listRuns: () => getJson<RunListEntry[]>("/api/runs"),
  getRun: (runId: string) => getJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`),
  getGame: (runId: string, gameIndex: number) =>
    getJson<GameDetail>(`/api/runs/${encodeURIComponent(runId)}/games/${gameIndex}`),
};
