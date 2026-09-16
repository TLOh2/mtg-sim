# Commander Simulator Platform

Import Commander decklists from Moxfield, Archidekt, or TappedOut, batch-simulate
pods of 4 through [Forge](https://github.com/card-forge/forge)'s headless engine,
and dig into the results in a web dashboard - win rates, mana consistency, fun
accolades, a cross-run leaderboard, and a visual replay of any individual game.

See `spec.json` for the full data model/decisions and `PROGRESS.md` for the
build history and what's been validated against real data.

## Just want to play? Download and run it

No coding, no installs - grab the latest package from the
[Releases page](https://github.com/TLOh2/mtg-sim/releases), then:

1. Extract the downloaded `.zip` anywhere.
2. Open the extracted `CommanderSim` folder.
3. Double-click **`Start.bat`**.

A browser tab opens automatically once it's ready. That's the whole setup -
the package bundles its own copy of Node.js and Java, so nothing else needs
to be installed on your machine, and nothing it does touches anything outside
that one folder.

Windows may show a security prompt the first time, since it's an unrecognized
script downloaded from the internet - click **More info → Run anyway**, and
allow it through the firewall prompt if one appears (it only listens on your
own machine; nothing here is exposed to the internet).

The rest of this README is for building it from source instead (for
development, or if you want to build your own package).

## What you can do with it

- **Batch-simulate a 4-player Commander pod** - pick saved decks or paste a
  fresh export, set how many games and how long each gets before it's called
  a draw, and let Forge play it out. A run shows live progress as each game
  finishes, and you can cancel one mid-run.
- **Tune the AI per seat** - each player can use Forge's Default AI or one of
  three alternate profiles (Cautious/Reckless/Experimental) if you want to
  see whether a deck plays differently under a more aggressive or more
  sacrifice-willing AI.
- **See real aggregate stats per run**: win rates, a deck diagnostics table
  (missed land drops, mana efficiency, how fast each deck ramps to 5/7/10
  mana - counting rocks and dorks, not just lands), curve efficiency, a rough
  1-5 power-bracket estimate, and a full attacker-vs-defender threat matrix.
- **Fun accolades** - Most Damage Dealt, Pyromaniac, Speedrunner, Iron Bank,
  Most Consistent, Rocky Start, and more, computed from that run's own
  numbers (skipped entirely when nothing in the run actually earns them).
- **See what a deck actually does** - a per-deck "cards cast" breakdown and a
  "never cast" list (dead cards/combo pieces the AI kept drawing but never
  used), both resolved against Forge's own card database so lands are
  correctly excluded rather than guessed from card names.
- **A cross-run deck leaderboard** - every deck's win rate and bracket across
  every run it's appeared in, with a dominance-over-time chart once a deck
  has played 2+ runs.
- **Dig into one game three ways**: a human-readable turn-by-turn **Story**
  view, the **Raw log**, and a visual **Replay** - watch the actual board
  state play out (battlefield, life totals, lands separated from other
  permanents, tapped mana, counters, the stack), with an attacker/target
  highlight so cause and effect are easy to follow, adjustable playback
  speed, and real card art on hover (via Scryfall).
- **Share results** - copy a single game's summary to your clipboard, export
  a whole run's game logs as a `.zip`, or print a run to PDF.
- **Light/dark/auto theme**, because it's 2026.

## Quick start (building from source)

```bash
git submodule update --init engine/forge   # vendored Forge, pinned commit
bash scripts/start-dashboard.sh
```

That's it - one command. The first run builds Forge and installs
dependencies (takes a few minutes; every run after that is fast), then starts
both servers and opens the dashboard in your browser. Press Ctrl+C in that
terminal to stop everything cleanly.

Click **+ New run**. For each of the 4 players, either pick an already-saved
deck from the dropdown, or choose **Paste new...** and paste that player's
decklist export - see "A note on how deck import works" below for the exact
steps per site and why it's a pasted decklist rather than a URL. A deck you
paste is saved automatically - next time it's just sitting in the dropdown,
no re-pasting. Submit; a full batch (20 games by default) can take a while,
but the run appears immediately with a "running" status and updates live, so
it's safe to navigate away and come back later.

### Baking in decks you always want available

Decks pasted through the dashboard only persist as long as `data/decks/`
does on whatever machine is running it - fine for casual use, but if there
are specific decks you want available *every* time, permanently, add them to
the repo instead: drop a file in `server/presets/decks/` shaped like:

```json
{
  "id": "some-unique-id",
  "label": "Deck name shown in the dropdown",
  "decklistText": "1 Sol Ring (CMM) 382\n1 Command Tower (LTC) 301\n...",
  "savedAt": "2025-01-01T00:00:00.000Z"
}
```

(`commanderPreview` is optional - computed automatically if omitted.) These
are committed to the repo, so they ship with every build - including the
downloadable package - unlike anything pasted through the site itself.
`server/presets/decks/eowyn-ayo-win.json` is a real example to copy the shape
from.

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
(e.g. Forge's own bundled Commander precons) rather than pasted decklists.
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

## Building your own downloadable package

The [Releases page](https://github.com/TLOh2/mtg-sim/releases) should have
what you need, but if you want to build a fresh one yourself (after making
changes, say):

```bash
bash engine/build.sh              # builds Forge (needed once, or after any Forge change)
bash scripts/fetch-runtimes.sh    # downloads portable Node.js + Java into vendor/ (once, cached after)
bash scripts/build-windows-package.sh
```

That assembles `dist-package/CommanderSim/` - a folder with everything
bundled in (portable Node.js, portable Java, the built dashboard, compiled
server, and only the Forge modules/resources actually needed to run a
simulation). Zip that folder and it's ready to share. Windows-only for now;
see `server/src/simulate/javaSim.ts` for the pieces that would need a macOS/
Linux equivalent (different portable-runtime downloads, mainly).

## Hosting it online instead

If you'd rather have one shared URL than everyone running their own copy
(trades "no compute cost for you" for "reachable from any device without a
download"), the `Dockerfile` at the repo root deploys as a single long-lived
container - built and tested against [Render](https://render.com):

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

Known tradeoffs of this path (none of these apply to the downloadable
package, which runs entirely on the person's own machine):

- **Runs aren't durable across redeploys.** `data/runs/` lives on the
  service's local disk, which most Render plans wipe on every deploy/restart.
  Render's persistent disks (a paid add-on) would fix this if you want it.
- **A run in progress needs the service to stay up** - some plans spin the
  instance down if nothing pings it for a while, which would kill an
  in-progress batch.
- **Forge needs real memory** - confirmed 512MB (Render's Starter plan) isn't
  enough; loading its ~34,000-card database crashed the whole service on a
  real deploy. `engine/run-sim.sh` caps the JVM at an explicit `-Xmx384m`
  (overridable via `FORGE_MAX_HEAP_MB`) so a too-small instance fails *one
  run* cleanly instead of crashing the whole service - but a plan with more
  RAM is the real fix if runs keep failing with an out-of-memory error.

### A note on how deck import works (and why)

The dashboard asks you to paste each deck's **decklist text**, not a URL -
because nothing that automatically fetches a deck from a deployed web app
actually works reliably:

- A server-side fetch (this deployment doing the fetching) got 403'd every
  time on Render, even with browser-like headers - consistent with
  TLS/network-level bot detection against datacenter traffic, which no
  header spoofing fixes.
- A browser-side fetch (your browser doing the fetching, on the server's
  behalf) gets blocked by CORS - confirmed directly: Moxfield's API sends no
  `Access-Control-Allow-Origin` header, so browsers refuse to let a
  different site's JavaScript read the response. This applies to every
  visitor equally, not just one browser or one deployment.
- TappedOut specifically also sits behind a Cloudflare bot check that blocks
  even an automated browser from loading the page at all.

Pasting the plain-text export sidesteps all of that: nothing here makes a
network request to any of these sites. The paste format is auto-detected, so
there's nothing to tell it which site it came from:

- **Moxfield**: on the deck page, **Export** → **Copy for Moxfield** (not
  "Copy for Arena"/"Copy for MTGO" - those drop cards those formats can't
  represent).
- **Archidekt**: on the deck page, **More** → **Export deck** → **Copy** -
  the default "Text" export works as-is, no settings to change.
- **TappedOut**: on the deck page, **Actions** → **Download / Export / Embed
  Code**, pick **CSV** from the dropdown (TappedOut's plain "Text" export
  doesn't mark which card is the commander, so CSV is the one that actually
  works here).

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
(cd server && npm test)             # log parsing + turning-point detection, unit-tested
```

`scripts/start-dashboard.sh` itself isn't a self-check with assertions (it's
meant to be run and left running, not to exit) - it was manually verified to
bring both servers up, serve the dashboard, and shut down cleanly (no
orphaned processes or held ports) on Ctrl+C. `scripts/build-windows-package.sh`
was verified by actually running the assembled package with the system PATH
stripped of Node/Java/Git entirely and completing a real simulation through it.

## Project layout

- `engine/` - vendored Forge (git submodule) + the Node code that spawns it
  directly (no shell involved - see `server/src/simulate/javaSim.ts`).
- `server/` - Node/TypeScript pipeline: deck import (Moxfield/Archidekt/
  TappedOut), `.dck` conversion, the Forge simulation runner, log parsing/
  analysis (stats, awards, turning points), and the dependency-free HTTP API
  the dashboard reads.
- `web/` - React + Vite dashboard, including the game replay viewer
  (`web/src/components/GameReplayView.tsx`).
- `scripts/` - dev tooling (`start-dashboard.sh`) and packaging
  (`fetch-runtimes.sh`, `build-windows-package.sh`).
- `data/runs/`, `data/decks/` - persisted run results and pasted decks
  (gitignored; regenerable/user-specific, not source).

## Known limitations

- `big_card_draw` (one of the seed turning-point signals) can't be detected:
  Forge's log has no draw events at all - see `PROGRESS.md` Phase 3.
- Storage is flat JSON files under `data/runs/`, not a database - fine for a
  single user, revisit if cross-run querying becomes a real need.
- The downloadable package is Windows-only for now (see "Building your own
  downloadable package" above).
- Combining an AI profile override with the (currently backend-only) AI
  look-ahead simulation mode on the same seat is known to break mana payment -
  see `server/src/simulate/javaSim.ts`'s `-sim` flag comments if you're
  touching that code.
