#!/usr/bin/env node
// Minimal HTTP API for the Phase 4 dashboard: reads persisted run summaries
// from data/runs/*.json (written by analyze-pod.ts / runAndAnalyzePod.ts) and
// serves them as JSON. No framework, no database - this is a single-user
// local tool reading flat files, per spec.json#tech_stack's rationale.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { RUNS_DIR } from "../analyze/runAndAnalyzePod.js";
import { startPodFromMoxfieldUrls } from "../analyze/startPodFromMoxfieldUrls.js";
import { extractMoxfieldPublicId } from "../importers/moxfield.js";
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

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const MAX_GAMES = 200;
const MAX_CLOCK_SECONDS = 1800;

// Path shape: /api/runs, /api/runs/:runId (summary without per-game rawLog/events),
// /api/runs/:runId/games/:gameIndex (one game's full events + rawLog).
const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] !== "api" || parts[1] !== "runs") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (parts.length === 2 && req.method === "POST") {
    let payload: { deckUrls?: unknown; games?: unknown; clockSeconds?: unknown };
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const deckUrls = payload.deckUrls;
    if (!Array.isArray(deckUrls) || deckUrls.length !== 4 || deckUrls.some((u) => typeof u !== "string" || !u.trim())) {
      sendJson(res, 400, { error: "deckUrls must be an array of exactly 4 non-empty Moxfield deck URLs" });
      return;
    }
    for (const deckUrl of deckUrls) {
      try {
        extractMoxfieldPublicId(deckUrl);
      } catch {
        sendJson(res, 400, { error: `Not a recognizable Moxfield deck URL: ${deckUrl}` });
        return;
      }
    }

    const games =
      typeof payload.games === "number" && Number.isFinite(payload.games)
        ? Math.min(Math.max(1, Math.floor(payload.games)), MAX_GAMES)
        : 20;
    const clockSeconds =
      typeof payload.clockSeconds === "number" && Number.isFinite(payload.clockSeconds)
        ? Math.min(Math.max(30, Math.floor(payload.clockSeconds)), MAX_CLOCK_SECONDS)
        : 180;

    const runId = `web-${randomUUID()}`;
    // Fire-and-forget: startPodFromMoxfieldUrls persists all progress/errors
    // to data/runs/<runId>.json itself (see its own try/catch), so there's
    // nothing more to do with this promise here.
    void startPodFromMoxfieldUrls({ runId, deckUrls, games, clockSeconds });

    sendJson(res, 202, { runId, status: "running" });
    return;
  }

  if (parts.length === 2) {
    const runs = listRunIds()
      .map(loadRun)
      .filter((r): r is RunSummary => r !== null)
      .map(({ runId, createdAt, status, error, playerNames, requestedGames, completedGames, winsByPlayer }) => ({
        runId,
        createdAt,
        status,
        error,
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
