# Progress Log — Commander Simulator Platform

## ⚠️ Read this first: PRD.md / spec.json did not exist

At session start, the repo (`TLOh2/mtg-sim`) had **zero commits and zero branches**,
locally and on GitHub (verified via `git log --all`, `git fetch`, `git ls-remote`, and
the GitHub API). `PRD.md` and `spec.json` — described as already present and as the
source of truth for scope/decisions/data model — did not exist anywhere.

Per the working instructions for this session (decide and keep moving rather than
block), I authored a `PRD.md` and `spec.json` myself, based on:
- the task description you gave me (Moxfield import, `.dck` conversion, Forge sim
  mode, 20-game default batches, log parsing + turning-point detection, a
  dashboard, Archidekt import with an open question on export shape), and
- direct research into the real Forge engine (`card-forge/forge` on GitHub), its
  CLI `sim` mode, and its `.dck` deck file format (confirmed by building it and
  reading its bundled Commander precon decks).

**This is the one thing in this session that most needs your review.** Everything
downstream (data model, turning-point signal list, tech stack choices) flows from
that reconstructed spec. Treat `spec.json` as a strong draft, not gospel — if any
of it conflicts with what you actually had in mind, that's expected; just tell me
and I'll adjust rather than having built further down a wrong path.

Nothing else in this log is a blocker of that kind — everything else below is a
reversible implementation choice, noted for your awareness, not for permission.

---

## Status by phase

- [x] **Phase 0 — Forge headless build + CLI sim smoke test** — DONE
- [~] **Phase 1 — Moxfield import → normalized decklist → `.dck`** — CODE DONE, live validation blocked (see below)
- [x] **Phase 2 — Wire pipeline into Forge sim mode (4-deck pod, 20-game batch)** — DONE
- [x] **Phase 3 — Log parsing + turning-point detection** — DONE
- [x] **Phase 4 — Results dashboard + game log viewer (web UI)** — DONE
- [ ] **Phase 5 — Archidekt import** — BLOCKED (see below), not started for real

## Phase 0 — done

Forge (`card-forge/forge`, pinned commit `61bc0b600f18940059b90e5caba1d57e226f65bb`,
tag `forge-2.0.14-392-g61bc0b600f1`) is vendored as a git submodule at
`engine/forge`. Verified working end to end:

- `engine/build.sh` builds just the 5 modules headless sim mode needs
  (`forge-core`, `forge-game`, `forge-ai`, `forge-gui`, `forge-gui-desktop`)
  and writes a runtime classpath to `engine/.runtime-classpath.txt`.
- `engine/run-sim.sh` wraps Forge's CLI `sim` mode, working around a real
  quirk: Forge's `-d` flag only accepts deck references relative to its own
  `$HOME/.forge/decks/commander/` directory, not arbitrary file paths (see
  `engine/NOTES.md` for the full writeup - this will matter for Phase 2's
  pipeline wiring).
- `scripts/phase0-smoke-test.sh` runs a full placeholder Commander game (two
  of Forge's own bundled Commander precon decks) through the wrapper and
  asserts a real `Game Result` line comes back. **Currently passing.**
- Also manually validated a real 4-player pod (matching the spec's default
  pod size) with full (non-quiet) logging: one full game completed in ~124s
  of wall time (turn 30), with realistic combat/death/life-swing sequences in
  the log. Confirms both that the AI reliably finishes multiplayer Commander
  games unattended, and gives a first real look at Forge's log line shapes
  for Phase 3's parser (documented in `engine/NOTES.md`).
- Run `bash scripts/phase0-smoke-test.sh` any time to re-verify this phase
  still works (e.g. after pulling a newer submodule commit).

## Phase 1 — code done; live validation blocked by network policy

**Blocker (flagging per instructions, not stopping for it):** this session's
outbound network egress policy blocks `moxfield.com` (and, spot-checked,
`archidekt.com`, `api.scryfall.com`, and even `example.com`) entirely - both
plain `curl` and the WebFetch tool get a hard `EGRESS_BLOCKED`/403 from the
organization's egress proxy. GitHub and the npm registry are allowed (that's
how `engine/forge` and `server/node_modules` got here), but general web
access is not. This is an environment/org policy setting, not something in
my control - see the "Environment configuration" note about network policy
in this session's system context. **I could not run the literal instruction
"validate against a couple of real Moxfield deck URLs."**

What I did instead, to make real (not fake) progress anyway:
- Built `server/src/importers/moxfield.ts` against the best available
  community-documented understanding of Moxfield's unofficial deck JSON API
  (`api2.moxfield.com/v3/decks/all/{publicId}`), written defensively (accepts
  a couple of known field-name variants for set code / collector number).
  **This exact shape is unverified against a live response.**
  It's plausible but should be treated as a draft until someone runs it for
  real.
- Wrote `server/fixtures/moxfield-commander-sample.json`, a hand-built
  fixture in that shape, and unit-tested normalization + `.dck` conversion
  against it (`server/src/importers/moxfield.test.ts` - 4 passing tests).
- Went one step further than a unit test alone: `scripts/phase1-smoke-test.sh`
  takes the fixture all the way through to a **real Forge game** - generates
  a `.dck` from it and hands it to Forge's sim mode alongside a real precon.
  Forge loaded every card (including bare name-only fallback lines for cards
  with no set/collector-number in the fixture) and played a complete game.
  This validates the `.dck` output format and Forge's card-name resolution
  for real; it does not and cannot validate that Moxfield's actual API
  matches what `moxfield.ts` expects.

**What I'd like you to do:** either (a) run
`cd server && npm run import:moxfield -- <a real Moxfield deck URL>` from
somewhere with normal internet access and tell me what breaks (most likely
culprit if something does: the exact `boards.mainboard.cards[key].card`
field names - `set` vs `set_code`, `cn` vs `collector_number` - easy to patch
once I see a real response), or (b) if this environment's network policy can
be widened to allow `moxfield.com`, I can run that validation myself next
session. Either way this is the one open item blocking Phase 1 from being
fully "done" rather than "done modulo live validation."

## Phase 2 — done

`server/src/simulate/forgeRunner.ts` + `parseGameResults.ts`: runs a batch
through `engine/run-sim.sh` and splits Forge's stdout into structured
per-game results (winner, draw flag, duration, raw log) on Forge's own
"Game Result: ..." lines. Validated for real: a full 4-deck pod (Forge's own
Commander precons), 20 games, `-c 120`, ran to completion - see
`data/runs/real-4p-pod.json` for the actual persisted output (also what
Phase 3/4 below validate against). `scripts/phase2-smoke-test.sh` is a fast
(2-game) repeatable version of the same check.

## Phase 3 — done

`server/src/parse/parseGameLog.ts` classifies each log line against Forge's
own `GameLogEntryType` captions (the authoritative list - see
`engine/forge/forge-game/.../GameLogEntryType.java`), tracks the running turn
number, and tags which known players a line involves by exact roster-name
matching (more reliable than regexing a name out of free text, since deck
names can contain almost anything).

`server/src/parse/turningPoints.ts` implements 9 of spec.json's 10 seed
signals: `large_life_swing`, `player_elimination`, `lethal_combat`,
`board_wipe`, `mass_land_destruction`, `extra_turn`, `combo_loop_detected`,
`key_counterspell`, `commander_cast_or_recast`. **`big_card_draw` is not
implemented** - Forge's `GameLogEntryType` enum has no draw-related entry at
all (confirmed by reading `forge-game`'s `Player.java`: the only similar
logged event is `DISCARD`). Individual card draws simply are not recorded in
Forge's log output, with or without verbose logging, so this signal can't be
detected without instrumenting the engine itself. Also worth flagging:
`key_counterspell` had to drop spec.json's ">= 5 mana value" threshold (no
CMC data in text logs) and flags every resolved counter instead - a
simplification, not a bug.

Tested against a real captured 4-player game (spliced from Phase 0's manual
testing) plus small synthetic snippets for signal-specific edge cases the
real capture didn't happen to contain (20 tests total in `server/`).

## Phase 4 — done

`server/src/analyze/runAndAnalyzePod.ts` ties simulate -> parse -> analyze
into one pipeline and persists each run to `data/runs/<run-id>.json`.
`server/src/api/server.ts` is a small dependency-free HTTP API reading that
directory (run list, one run's summary, one game's full detail). `web/` is a
Vite + React dashboard: a run list with per-deck win rates, a run detail view
(games table with turning-point counts), and a game log view (the full event
timeline with turning points highlighted inline).

Run it yourself: `cd server && npm run api` (port 4000), then
`cd web && npm run dev` and open the printed localhost URL. Real data to look
at: `data/runs/real-4p-pod.json` (20-game batch, Forge's own Commander
precons ×4) - generate more via `npm run analyze:pod -- <run-id> <deck1.dck>
... <deck4.dck> [games] [clockSeconds]` in `server/`.

`scripts/phase4-smoke-test.sh` runs its own small batch, hits all three API
endpoints against the real persisted result, and builds the web app - a
faithful "does this actually work" check rather than just a green typecheck.

## Phase 5 — blocked, deliberately not guessed at

Same network restriction as Phase 1 (`archidekt.com` is blocked by this
session's egress policy - re-confirmed directly, not assumed). The
difference from Phase 1: the task's own framing already flagged Archidekt's
export shape as an open question and said explicitly to resolve it
empirically rather than guess. I could reasonably use my own judgment to
write a best-effort Moxfield importer against community documentation
(Phase 1), but writing speculative Archidekt-parsing code here would be
guessing at exactly the thing I was told not to guess at. So instead:
`server/src/importers/archidekt.ts` is a stub that explains why and throws
if called - not a real importer.

**What I'd like you to do:** send me one real Archidekt deck URL, or a raw
copy of what `GET` on its deck API/export endpoint returns for one deck (open
it in a browser's network tab, or `curl` it yourself), or widen this
environment's network policy to allow `archidekt.com`. Any of those unblocks
writing the real importer the same way Phase 1's was built.

## Decisions / assumptions made along the way

- Reconstructed `PRD.md`/`spec.json` from scratch (see warning above).
- Engine: vendoring Forge (`card-forge/forge`) as a git submodule under
  `engine/forge/`, pinned to a specific commit, rather than committing its ~58k
  files into this repo's history. Build produces jars under Maven's local repo;
  we don't commit build output either.
- Only building the modules Forge's own CLI `sim` mode needs
  (`forge-core`, `forge-game`, `forge-ai`, `forge-gui`, `forge-gui-desktop`) —
  skipping mobile/android/ios/adventure-editor/installer, which aren't needed for
  headless simulation and substantially slow the build.
- Backend + import/conversion pipeline: Node.js + TypeScript. Frontend dashboard:
  React + Vite. Storage: SQLite (file-based, zero external services to run).
  Rationale: single language across pipeline/API/UI, minimal ops overhead for a
  personal/small-scale tool.
- Placeholder decks for the Phase 0 smoke test: Forge ships real, valid Commander
  precon `.dck` files in its own resources
  (`forge-gui/res/adventure/common/decks/starter/commander/*.dck`). Using two of
  those rather than hand-writing fake ones, since they're guaranteed
  well-formed and exercise the real card database.

- Server package (`server/`): Node 22 + TypeScript, ESM, native `fetch`, no
  extra runtime deps yet. Tests via Node's built-in `node:test` + `tsx`
  (no vitest/jest) to keep the dependency footprint minimal for now - revisit
  if test needs grow past what that comfortably covers.
- `.dck` card-line resolution strategy: emit the full `name|SET|CN` form when
  the source deck gives us both; otherwise fall back to a bare `name` line.
  Forge's own deck-line parser (`DeckRecognizer`) accepts both and resolves
  the bare form to *some* legal printing by name - confirmed by feeding a
  fixture with both line shapes through a real Forge game (see
  `scripts/phase1-smoke-test.sh`). This avoids needing to duplicate Forge's
  ~34k-card index in the Node pipeline just to validate printings up front.

## Blockers (one-way-door items)

- **Network egress to Moxfield/Archidekt is blocked in this session** (see
  "Phase 1" above for full detail). Not a permission question, just flagging
  it since it's the one thing actually outside my control right now.
