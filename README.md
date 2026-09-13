# Commander Simulator Platform

Import Commander decklists from Moxfield, batch-simulate pods of 4 through
[Forge](https://github.com/card-forge/forge)'s headless engine, and browse
aggregate results and individual game logs in a web dashboard.

See `spec.json` for the full data model/decisions and `PROGRESS.md` for the
build history and what's been validated against real data.

## Quick start

```bash
git submodule update --init engine/forge   # vendored Forge, pinned commit
bash scripts/start-dashboard.sh
```

That's it - one command. The first run builds Forge and installs
dependencies (takes a few minutes; every run after that is fast), then starts
both servers and opens the dashboard in your browser. Press Ctrl+C in that
terminal to stop everything cleanly.

Click **+ New run**, paste 4 Moxfield deck URLs (`https://moxfield.com/decks/<id>`,
one per player), and submit. A full batch (20 games by default) can take a
while; the run appears immediately with a "running" status and the page
polls until it's done, so it's safe to navigate away and come back later.

### Running the two servers by hand

`scripts/start-dashboard.sh` is just a wrapper around these two commands, in
case you want more control (a fixed port, separate terminals to watch each
server's own output, etc.):

```bash
# terminal 1
cd server && npm run api        # API server on :4000

# terminal 2
cd web && npm run dev           # dashboard on the printed localhost URL (proxies /api -> :4000)
```

## Running it: the CLI

Useful for scripting, or for simulating pods built from local `.dck` files
(e.g. Forge's own bundled Commander precons) rather than Moxfield URLs.
All commands run from `server/`:

```bash
# Fetch + convert one Moxfield deck to a .dck file
npm run import:moxfield -- https://moxfield.com/decks/<id> out/player1.dck

# Run a 4-deck pod through Forge, parse the logs, detect turning points,
# and persist the result to data/runs/<run-id>.json for the dashboard to read
npm run analyze:pod -- <run-id> deck1.dck deck2.dck deck3.dck deck4.dck [games=20] [clockSeconds=180]
```

`npm run sim:pod` is the same simulation step alone (no parsing/analysis), if
you just want raw per-game results.

## Deploying (e.g. Render), so you can use it from your phone

The two options above run on your own machine only. To reach the dashboard
from anywhere (cellular data, no computer left running), deploy the
`Dockerfile` at the repo root to a host that can run a long-lived container -
this was built and tested against [Render](https://render.com):

1. Push this repo to GitHub if it isn't already (Render deploys from a Git
   repo).
2. In Render: **New +** → **Blueprint**, point it at this repo. Render
   should pick up `render.yaml` at the repo root automatically and configure
   the service for you (Docker build, health check, `NODE_ENV`). If you'd
   rather do it by hand instead: **New +** → **Web Service**, runtime
   **Docker**, dockerfile path `./Dockerfile`.
3. Pick a plan with enough CPU/RAM/build-time headroom - `render.yaml`
   defaults to **Starter**. The free plan is unlikely to work: building Forge
   (a real Maven build of a large Java project) and then running a JVM per
   simulation batch both need more than free-tier resources typically allow.
4. Deploy. First build will take a while (compiling Forge from source). Once
   it's up, Render gives you a public `https://<your-service>.onrender.com`
   URL - that's what you open on your phone.

What to know before relying on it:

- **This has not been deployed and exercised end to end by me** - this
  session's own network access is restricted (can't reach Render, Docker
  Hub, or moxfield.com directly - see `PROGRESS.md`), so everything above
  was built and locally reasoned through as carefully as possible (the
  static-file serving, the Dockerfile's internal paths, path-traversal
  safety) but the actual "deploy on Render and click New run from an
  iPhone" path is unproven. Please try it and tell me what breaks - that's
  exactly the pattern that caught the MDFC bug and would catch anything
  wrong here too.
- **Runs aren't durable across redeploys.** `data/runs/` lives on the
  service's local disk, which most Render plans wipe on every deploy/restart.
  Fine for "start a run, check results later that day"; not fine for
  "results from months ago." Render's persistent disks (a paid add-on) would
  fix this if you want it - ask and I'll wire it in.
- **A run in progress needs the service to stay up.** If nothing polls the
  service for a while, some plans spin the instance down, which would kill
  an in-progress batch. Your dashboard tab polling every 4s while a run is
  "running" should count as activity and prevent that, but a plan that
  doesn't auto-sleep is the safer bet if you plan to close the tab mid-run.

## Self-checks

Each phase has a script under `scripts/` that proves it actually works (not
just "compiles") against something real - Forge's own precon decks, a real
captured game log, or a locally-run API server:

```bash
bash scripts/phase0-smoke-test.sh   # Forge builds and runs a real game headless
bash scripts/phase1-smoke-test.sh   # Moxfield fixture -> .dck -> real Forge game
bash scripts/phase2-smoke-test.sh   # 4-deck pod, multi-game batch, real results
bash scripts/phase4-smoke-test.sh   # API + dashboard serve a real persisted run
bash scripts/dashboard-start-run-smoke-test.sh  # POST /api/runs request/response plumbing
(cd server && npm test)             # log parsing + turning-point detection (Phase 3), unit-tested
```

`scripts/start-dashboard.sh` itself isn't a self-check with assertions (it's
meant to be run and left running, not to exit) - it was manually verified to
bring both servers up, serve the dashboard, and shut down cleanly (no
orphaned processes or held ports) on Ctrl+C.

## Project layout

- `engine/` - vendored Forge (git submodule) + build/run wrapper scripts.
- `server/` - Node/TypeScript pipeline: Moxfield import, `.dck` conversion,
  Forge simulation runner, log parsing/turning-point detection, and the
  dependency-free HTTP API the dashboard reads.
- `web/` - React + Vite dashboard.
- `data/runs/` - persisted run results (gitignored; regenerable output).

## Known limitations

- Archidekt import is deprioritized (Moxfield is the only source currently
  wired up) - see `server/src/importers/archidekt.ts` and `PROGRESS.md`.
- `big_card_draw` (one of the seed turning-point signals) can't be detected:
  Forge's log has no draw events at all - see `PROGRESS.md` Phase 3.
- Storage is flat JSON files under `data/runs/`, not a database - fine for a
  single local user, revisit if cross-run querying becomes a real need.
