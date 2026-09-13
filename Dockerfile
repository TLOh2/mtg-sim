# Single-service deployment image: builds Forge (Java/Maven) and this repo's
# Node/TypeScript pipeline + dashboard, then runs one process that serves
# both the API and the built dashboard's static assets (see
# server/src/api/server.ts). Meant for a platform like Render where you want
# one deployable unit reachable at a public URL - see README.md's
# "Deploying (e.g. Render)" section for the non-Docker parts of the setup.
FROM node:22-bookworm

# Java 17 + Maven to build/run Forge; git to fetch it at the pinned commit
# (done here rather than relying on the engine/forge git submodule being
# checked out by whatever cloned this repo, which varies by platform).
RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-17-jdk-headless \
        maven \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Forge (vendored at the pinned commit; see engine/forge-pin.txt / PROGRESS.md) ---
COPY engine/forge-pin.txt engine/build.sh engine/run-sim.sh /app/engine/
RUN git clone --filter=blob:none https://github.com/card-forge/forge.git /app/engine/forge \
    && git -C /app/engine/forge checkout "$(cat /app/engine/forge-pin.txt)"
RUN bash /app/engine/build.sh

# --- Server (Node/TypeScript pipeline + API) ---
COPY server/package*.json /app/server/
RUN cd /app/server && npm ci
COPY server /app/server

# --- Dashboard (built to static assets the server itself serves - see
# server/src/api/server.ts's serveStatic) ---
COPY web/package*.json /app/web/
RUN cd /app/web && npm ci
COPY web /app/web
RUN cd /app/web && npm run build

ENV NODE_ENV=production
EXPOSE 4000
WORKDIR /app/server
CMD ["npx", "tsx", "src/api/server.ts"]
