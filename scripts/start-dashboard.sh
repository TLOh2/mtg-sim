#!/usr/bin/env bash
# One-command launch: builds Forge and installs dependencies the first time
# they're needed, starts the API server and the dashboard, and opens your
# browser to it. Press Ctrl+C in this terminal to stop everything.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "engine/.runtime-classpath.txt" ]; then
    echo "First-time setup: building Forge (this can take a few minutes)..."
    bash engine/build.sh
fi

if [ ! -d "server/node_modules" ]; then
    echo "Installing server dependencies..."
    (cd server && npm install)
fi

if [ ! -d "web/node_modules" ]; then
    echo "Installing dashboard dependencies..."
    (cd web && npm install)
fi

API_PORT="${API_PORT:-4000}"
API_LOG="$(mktemp -t mtg-sim-api-XXXXXX.log)"
WEB_LOG="$(mktemp -t mtg-sim-web-XXXXXX.log)"

# Both background servers get their output redirected to a log file rather
# than inherited - if this script is ever run under a pipe, an inherited
# pipe is held open by these long-lived processes indefinitely (see
# PROGRESS.md's Phase 4 writeup for the 2+ hour hang that taught us this).
echo "Starting API server on :$API_PORT (log: $API_LOG)..."
(cd server && PORT="$API_PORT" npx tsx src/api/server.ts) >"$API_LOG" 2>&1 &
API_PID=$!

cleanup() {
    echo
    echo "Stopping..."
    kill "$API_PID" 2>/dev/null || true
    local api_leftover
    api_leftover="$(lsof -ti ":$API_PORT" 2>/dev/null || true)"
    [ -n "$api_leftover" ] && kill $api_leftover 2>/dev/null || true

    if [ -n "${WEB_PID:-}" ]; then
        kill "$WEB_PID" 2>/dev/null || true
    fi
    if [ -n "${WEB_PORT:-}" ]; then
        local web_leftover
        web_leftover="$(lsof -ti ":$WEB_PORT" 2>/dev/null || true)"
        [ -n "$web_leftover" ] && kill $web_leftover 2>/dev/null || true
    fi
    rm -f "$API_LOG" "$WEB_LOG"
}
trap cleanup EXIT

echo "Waiting for the API server to come up..."
for _ in $(seq 1 60); do
    if curl -sS --max-time 1 "http://localhost:$API_PORT/api/runs" >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

echo "Starting dashboard..."
(cd web && npx vite) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

WEB_URL=""
for _ in $(seq 1 60); do
    WEB_URL="$(sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$WEB_LOG" 2>/dev/null | grep -oE 'http://localhost:[0-9]+/?' | head -1 || true)"
    [ -n "$WEB_URL" ] && break
    sleep 0.5
done

if [ -z "$WEB_URL" ]; then
    echo "Dashboard didn't start in time - check $WEB_LOG for details:"
    cat "$WEB_LOG" >&2
    exit 1
fi
WEB_PORT="$(echo "$WEB_URL" | sed -E 's#.*:([0-9]+)/?#\1#')"

echo
echo "Dashboard ready: $WEB_URL"
echo "Press Ctrl+C here to stop everything."
echo

if command -v open >/dev/null 2>&1; then
    open "$WEB_URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$WEB_URL" >/dev/null 2>&1 || true
elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$WEB_URL" >/dev/null 2>&1 || true
fi

wait "$WEB_PID"
