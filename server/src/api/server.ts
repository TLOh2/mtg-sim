#!/usr/bin/env node
// Minimal HTTP API for the Phase 4 dashboard: reads persisted run summaries
// from data/runs/*.json (written by analyze-pod.ts / runAndAnalyzePod.ts) and
// serves them as JSON. No framework, no database - this is a single-user
// local tool reading flat files, per spec.json#tech_stack's rationale.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { RUNS_DIR } from "../analyze/runAndAnalyzePod.js";
import type { RunSummary } from "../analyze/types.js";

const PORT = Number(process.env.PORT ?? 4000);

function listRunIds(): string[] {
  try {
    return readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

function loadRun(runId: string): RunSummary | null {
  try {
    return JSON.parse(readFileSync(path.join(RUNS_DIR, `${runId}.json`), "utf-8"));
  } catch {
    return null;
  }
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

// Path shape: /api/runs, /api/runs/:runId (summary without per-game rawLog/events),
// /api/runs/:runId/games/:gameIndex (one game's full events + rawLog).
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "api" || parts[1] !== "runs") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (parts.length === 2) {
    const runs = listRunIds()
      .map(loadRun)
      .filter((r): r is RunSummary => r !== null)
      .map(({ runId, createdAt, playerNames, requestedGames, completedGames, winsByPlayer }) => ({
        runId,
        createdAt,
        playerNames,
        requestedGames,
        completedGames,
        winsByPlayer,
      }));
    sendJson(res, 200, runs);
    return;
  }

  const runId = parts[2];
  const run = loadRun(runId);
  if (!run) {
    sendJson(res, 404, { error: `no such run: ${runId}` });
    return;
  }

  if (parts.length === 3) {
    // Summary view: everything except the heavy per-game events/rawLog.
    const { games, ...summary } = run;
    sendJson(res, 200, {
      ...summary,
      games: games.map(({ gameIndex, winnerName, isDraw, durationMs, turningPoints }) => ({
        gameIndex,
        winnerName,
        isDraw,
        durationMs,
        turningPointCount: turningPoints.length,
      })),
    });
    return;
  }

  if (parts.length === 5 && parts[3] === "games") {
    const gameIndex = Number(parts[4]);
    const game = run.games.find((g) => g.gameIndex === gameIndex);
    if (!game) {
      sendJson(res, 404, { error: `no such game: ${gameIndex}` });
      return;
    }
    sendJson(res, 200, game);
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
