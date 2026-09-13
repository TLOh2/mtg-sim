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
- [x] **Phase 1 — Moxfield import → normalized decklist → `.dck`** — DONE, validated against a real live Moxfield deck (see below)
- [x] **Phase 2 — Wire pipeline into Forge sim mode (4-deck pod, 20-game batch)** — DONE
- [x] **Phase 3 — Log parsing + turning-point detection** — DONE
- [x] **Phase 4 — Results dashboard + game log viewer (web UI)** — DONE, now also supports starting a run from the browser (see below)
- [ ] **Phase 5 — Archidekt import** — DEPRIORITIZED BY USER (see below); not pursuing further unless asked

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

## Phase 1 — done, validated against real live Moxfield data

This session's own outbound network egress policy blocks `moxfield.com`
entirely (confirmed via both `curl` and the WebFetch tool - `EGRESS_BLOCKED`/
403 from the org's egress proxy; `archidekt.com`, `api.scryfall.com`, and
even `example.com` are blocked the same way). I could not fetch a live deck
myself. Instead, you fetched one for me: a real deck URL
(`https://moxfield.com/decks/IkRqYB5fpU2SkgSyzAuJpA`, a Jeskai Human Knights
Commander deck with commander Éowyn, Shieldmaiden) and pasted the complete
raw JSON response from Moxfield's own API. That closes out this phase for
real:

- **`boards.{commanders,mainboard,sideboard}.cards` is a
  `Record<string, entry>`, each entry `{ quantity, card: { name, set, cn, ... } }`
  — confirmed exactly as `moxfield.ts` already assumed.** `card.set` and
  `card.cn` are the real field names; the `set_code`/`collector_number`
  fallbacks in `toCardRef` turned out to be unneeded defensive code (kept,
  harmless) rather than something load-bearing.
- One real wrinkle the live data surfaced that the hand-built fixture hadn't
  covered: **modal double-faced cards (MDFCs)** come back with a combined
  "Front // Back" display name (the real deck had
  "Needleverge Pathway // Pillarverge Pathway"). Forge's card database
  indexes these by front-face name only, and its deck-line parser
  (`DeckRecognizer`) is lenient enough to accept the "/" characters rather
  than reject the line outright - so an unmodified combined name would have
  silently failed to resolve at sim time instead of erroring loudly. Fixed
  in `server/src/convert/dck.ts` (`frontFaceName()` strips everything from
  `" // "` onward before emitting a card line), with a regression test
  (`moxfield.test.ts`) asserting the `.dck` output uses the front face only.
- `server/fixtures/moxfield-commander-sample.json` now includes an MDFC
  entry so this stays covered without needing live access to re-verify.
- Existing coverage still holds: `server/src/importers/moxfield.test.ts`
  (now 4 tests, updated for the MDFC case) and
  `scripts/phase1-smoke-test.sh` (fixture → `.dck` → real Forge game,
  every card resolves and a full game plays out).

Net result: the importer's field-name assumptions were correct on the first
try; the only real bug real data caught was the MDFC name-truncation case,
now fixed and tested.

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

Also sanity-checked against the real 20-game batch (see Phase 2/4): 292
turning points total across 20 games, breaking down as 162
`commander_cast_or_recast`, 64 `large_life_swing`, 24 `lethal_combat`, 17
`board_wipe`, 13 `player_elimination`, 11 `combo_loop_detected`, 1
`mass_land_destruction`, 0 `key_counterspell`. All plausible for 20 games of
4 precons repeatedly casting/recasting their commanders and grinding each
other down - nothing jumped out as an obviously-wrong heuristic on real data.

## Phase 4 — done

`server/src/analyze/runAndAnalyzePod.ts` ties simulate -> parse -> analyze
into one pipeline and persists each run to `data/runs/<run-id>.json`.
`server/src/api/server.ts` is a small dependency-free HTTP API reading that
directory (run list, one run's summary, one game's full detail). `web/` is a
Vite + React dashboard: a run list with per-deck win rates, a run detail view
(games table with turning-point counts), and a game log view (the full event
timeline with turning points highlighted inline).

Run it yourself: `cd server && npm run api` (port 4000), then
`cd web && npm run dev` and open the printed localhost URL.

Real data already generated (not committed - `data/runs/*` is gitignored,
since it's regenerable output, not source; one 20-game run's JSON came out to
~8.7MB, which felt like the wrong thing to put in git history): a real
20-game batch of Forge's own Commander precons ×4 ran to completion -
20/20 games, win split Red 2 / Blue 3 / Black 5 / Green 10. Regenerate it (or
any other pod) via `npm run analyze:pod -- <run-id> <deck1.dck> ...
<deck4.dck> [games] [clockSeconds]` in `server/` - it writes
`data/runs/<run-id>.json` for the dashboard to pick up.

`scripts/phase4-smoke-test.sh` runs its own small batch, hits all three API
endpoints against the real persisted result, and builds the web app - a
faithful "does this actually work" check rather than just a green typecheck.

### Update: starting a run from the dashboard (paste 4 Moxfield URLs)

You asked for a UI where people can post their four decks, rather than
needing the CLI to kick off a run. Added:

- `POST /api/runs` (`server/src/api/server.ts`): takes `{ deckUrls: string[4],
  games?, clockSeconds? }`, validates each URL looks like a real Moxfield
  deck URL (400 otherwise), generates a run id, and fires
  `startPodFromMoxfieldUrls` (new: `server/src/analyze/startPodFromMoxfieldUrls.ts`)
  without waiting for it - responds `202` immediately with the run id.
- That function imports each of the 4 decks (in parallel), converts each to
  `.dck` in a temp staging directory, then hands off to the same
  `runAndAnalyzePod` the CLI already used - one pipeline, two entry points.
- `RunSummary` gained a `status: "running" | "complete" | "failed"` field
  (plus `error` and `deckUrls`). `runAndAnalyzePod` now writes a `"running"`
  placeholder immediately (a 20-game batch is not fast) and overwrites it
  with `"complete"`/`"failed"` when done, so the dashboard has something
  real to show and poll against the whole time, not just at the end.
- `web/`: a "+ New run" form (`NewRunForm.tsx`) on the run list posts to the
  new endpoint and jumps straight to the new run's detail page; both the run
  list and detail view poll every 4s while anything is `"running"` and show
  a status badge (running/complete/failed, with the error message on hover
  for failed runs).

Validated with a new script, `scripts/dashboard-start-run-smoke-test.sh`:
starts a real API server, confirms a malformed URL is rejected with 400,
confirms a well-formed request gets a run id back and the run shows up as
`"running"` in the list *immediately* (before any Moxfield fetch has even
completed), and confirms that when the (blocked-in-this-session) Moxfield
fetch actually fails, the run transitions to a real `"failed"` status with
a readable error message rather than hanging or crashing the server. What
this can't validate here: an actual successful run from a real Moxfield URL
end to end, since this session still can't reach moxfield.com - that's the
same limitation Phase 1 had, and the same fix applies (run it from
somewhere with normal network access, or paste me the URLs/JSON and I'll
walk through it with you).

### Update: one-command launch

You asked for "a website I can paste my Moxfield decks into." Clarified
scope first: a real publicly-reachable URL would mean actual server hosting
(a machine with Java + Forge + outbound internet, running continuously) -
that's a real infrastructure/cost decision needing your call, not mine. You
picked local-and-easy instead: same dashboard as before, but one command.

Added `scripts/start-dashboard.sh`: builds Forge and installs npm deps the
first time (if not already done), starts the API server and the dashboard
dev server (both logging to temp files rather than this script's own
stdout - see the pipe-hang lesson below), waits for each to actually be
listening, opens your default browser to the dashboard, and on Ctrl+C tears
both down cleanly (via `lsof` on each port, not just the originally-captured
PIDs - same belt-and-suspenders cleanup as `phase4-smoke-test.sh`, for the
same reason).

Manually verified: started it, confirmed both the API (`:4000`) and
dashboard (`:5173`) came up and served real responses, sent it a real
`SIGINT` (not just killing a wrapper PID - made that mistake once during
testing and it left orphans, corrected by signaling the actual script
process), and confirmed both ports were completely free afterward with no
leftover `tsx`/`vite` processes.

**A real bug worth recording:** the first version of this script hung for
2+ hours (you caught it - thank you). Root cause, confirmed via `/proc`
inspection of the stuck process: the background API server inherited this
script's own stdout, so when the script ran under a pipe, the server held
that pipe's write end open indefinitely, and `kill "$API_PID"` only killed
the immediate subshell, not the actual node process npx/tsx forked
underneath it, which got reparented to init and just sat there. Fixed by
redirecting the server's output to a log file instead of inheriting the
script's, and by having cleanup kill whatever's actually bound to the port
(via `lsof`) rather than trust the originally-captured PID. Re-ran it after
the fix: completed in about a minute, passed, and left zero processes or open
ports behind - confirmed directly, not assumed.

## Phase 5 — deprioritized by you; dropped from active scope

Was going to be blocked anyway (`archidekt.com` is blocked by this session's
network policy, same as Moxfield, and the spec explicitly said not to guess
its export shape - see the stub at `server/src/importers/archidekt.ts` and
the reasoning that was here before). Moot now: you confirmed Moxfield is what
you actually use, so this isn't worth spending more effort on. Leaving the
stub in place (it's harmless and cheap to finish later if you ever do want
Archidekt support) but not pursuing it further unless you ask.

Redirecting that effort at Moxfield instead - see the ask right below.

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
- Storage: deviated from `spec.json`'s original "SQLite" plan to plain flat
  JSON files, one per run, under `data/runs/<run-id>.json` (gitignored -
  regenerable output, not source). A run is written once by one process and
  read by the API/dashboard afterward; there's no concurrent-writer or
  querying-across-runs need that would justify a database yet. `spec.json`
  updated to reflect this as the actual decision. Revisit if/when cross-run
  querying (e.g. "compare win rates across runs") becomes a real need.
- `.dck` card-line resolution strategy: emit the full `name|SET|CN` form when
  the source deck gives us both; otherwise fall back to a bare `name` line.
  Forge's own deck-line parser (`DeckRecognizer`) accepts both and resolves
  the bare form to *some* legal printing by name - confirmed by feeding a
  fixture with both line shapes through a real Forge game (see
  `scripts/phase1-smoke-test.sh`). This avoids needing to duplicate Forge's
  ~34k-card index in the Node pipeline just to validate printings up front.

## Blockers (one-way-door items)

- **Network egress to Moxfield/Archidekt is blocked in this session.** For
  Moxfield this stopped being a real blocker: you fetched a live deck and
  pasted the JSON, which was enough to fully validate Phase 1 (see "Phase 1"
  above). Archidekt import is deprioritized anyway (see below), so this only
  matters if that's picked back up later.
