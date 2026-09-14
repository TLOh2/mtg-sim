#!/usr/bin/env node
// HTTP API for the dashboard: reads persisted run summaries from
// data/runs/*.json (written by analyze-pod.ts / runAndAnalyzePod.ts) and
// serves them as JSON. No framework, no database - this is a single-user
// tool reading flat files, per spec.json#tech_stack's rationale.
//
// Also serves the dashboard's own built static assets (web/dist) for any
// non-/api path, so this one process is everything a deployment (e.g.
// Render) needs to run - no separate static host or dev-server proxy. In
// local development, web/dist won't exist (you're running `vite dev`
// against this API instead), so that branch just 404s harmlessly.
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RUNS_DIR, writeRunSummary } from "../analyze/runAndAnalyzePod.js";
import { startPodFromDecklistText } from "../analyze/startPodFromDecklistText.js";
import { cancelRun } from "../simulate/activeRuns.js";
import { computeCardCastCounts, computeGameStats, computeRunAggregateStats } from "../analyze/gameStats.js";
import { listDecks } from "../decks/deckLibrary.js";
import type { DeckSelection } from "../decks/types.js";
import type { RunSummary } from "../analyze/types.js";

const PORT = Number(process.env.PORT ?? 4000);
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const WEB_DIST_DIR = path.join(REPO_ROOT, "web", "dist");

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function serveStatic(res: import("node:http").ServerResponse, pathname: string) {
  // Resolve within WEB_DIST_DIR only - reject anything that escapes it
  // (e.g. via "..") before touching the filesystem.
  const requested = path.normalize(path.join(WEB_DIST_DIR, pathname));
  if (!requested.startsWith(WEB_DIST_DIR)) {
    res.writeHead(400).end();
    return;
  }

  let filePath = requested;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback: this app has no client-side routes beyond "/", but
    // falling back to index.html for any unrecognized path is harmless and
    // avoids a confusing 404 on a refresh/deep link.
    filePath = path.join(WEB_DIST_DIR, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404).end("Dashboard build not found - run `npm run build` in web/.");
    return;
  }

  const contentType = STATIC_CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(readFileSync(filePath));
}

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

  if (parts[0] !== "api") {
    serveStatic(res, url.pathname);
    return;
  }

  if (parts[1] === "decks" && parts.length === 2) {
    sendJson(res, 200, listDecks());
    return;
  }

  if (parts[1] !== "runs") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (parts.length === 2 && req.method === "POST") {
    let payload: { decks?: unknown; games?: unknown; clockSeconds?: unknown };
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    // Each entry is either { deckId } (pick from the saved library) or
    // { label, decklistText } (paste fresh - auto-saved to the library by
    // startPodFromDecklistText). Nothing here fetches Moxfield itself: both
    // a server-side fetch (bot detection, confirmed 403 on a real deploy)
    // and a browser-side fetch (CORS, confirmed blocked in a real browser)
    // turned out to be dead ends - see PROGRESS.md.
    const decks = payload.decks;
    const isValidSelection = (d: unknown): d is DeckSelection => {
      if (typeof d !== "object" || d === null) return false;
      if ("deckId" in d) return typeof (d as { deckId: unknown }).deckId === "string";
      return (
        typeof (d as { label?: unknown }).label === "string" &&
        typeof (d as { decklistText?: unknown }).decklistText === "string" &&
        !!(d as { decklistText: string }).decklistText.trim()
      );
    };
    if (!Array.isArray(decks) || decks.length !== 4 || !decks.every(isValidSelection)) {
      sendJson(res, 400, {
        error:
          "decks must be an array of exactly 4 entries, each either { deckId } or { label, decklistText }",
      });
      return;
    }
    const deckSelections = decks as DeckSelection[];

    const games =
      typeof payload.games === "number" && Number.isFinite(payload.games)
        ? Math.min(Math.max(1, Math.floor(payload.games)), MAX_GAMES)
        : 20;
    const clockSeconds =
      typeof payload.clockSeconds === "number" && Number.isFinite(payload.clockSeconds)
        ? Math.min(Math.max(30, Math.floor(payload.clockSeconds)), MAX_CLOCK_SECONDS)
        : 180;

    const runId = `web-${randomUUID()}`;
    // Fire-and-forget: startPodFromDecklistText persists all progress/errors
    // to data/runs/<runId>.json itself (see its own try/catch), so there's
    // nothing more to do with this promise here.
    void startPodFromDecklistText({ runId, decks: deckSelections, games, clockSeconds });

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

  if (parts.length === 4 && parts[3] === "cancel" && req.method === "POST") {
    if (run.status !== "running") {
      sendJson(res, 409, { error: `run ${runId} is not running (status: ${run.status})` });
      return;
    }
    const cancelled = cancelRun(runId);
    if (!cancelled) {
      // Status still says "running" on disk, but the process behind it is
      // gone (e.g. the API server itself restarted) - nothing left to kill.
      sendJson(res, 409, { error: `no active process found for run ${runId} - it may have already stopped` });
      return;
    }
    sendJson(res, 202, { cancelled: true });
    return;
  }

  // Derived, on-the-fly stats (see gameStats.ts) - not persisted, computed
  // fresh from analyticsEvents each request so the formulas can be tuned
  // without re-running any simulations.
  if (parts.length === 4 && parts[3] === "stats") {
    const games = run.games.map((g) =>
      computeGameStats(g.gameIndex, g.analyticsEvents ?? [], run.playerNames, run.commandersByPlayer ?? {}),
    );
    const gameStatsByIndex = new Map(games.map((g) => [g.gameIndex, g]));
    const aggregate = computeRunAggregateStats(run.games, gameStatsByIndex, run.playerNames);
    const cardCastCounts = computeCardCastCounts(run.games, run.playerNames);
    sendJson(res, 200, { games, aggregate, cardCastCounts });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

// A run left as "running" on disk when this process starts can only mean
// the previous server process died (crash, restart, machine restart) with
// that run's Forge process as one of its children - which died with it. No
// process can ever come back to finish it, so it would otherwise sit
// "running" forever and never let the dashboard's polling loop stop. Fix up
// any such stragglers once at boot, before serving any requests.
function reconcileOrphanedRuns(): void {
  for (const runId of listRunIds()) {
    const run = loadRun(runId);
    if (run?.status !== "running") continue;
    writeRunSummary({
      ...run,
      status: "failed",
      error: "Interrupted: the server restarted while this run was in progress. Start a new run.",
    });
  }
}
reconcileOrphanedRuns();

server.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
