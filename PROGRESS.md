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
- [ ] Phase 1 — Moxfield import → normalized decklist → `.dck`
- [ ] Phase 2 — Wire pipeline into Forge sim mode (4-deck pod, 20-game batch)
- [ ] Phase 3 — Log parsing + turning-point detection
- [ ] Phase 4 — Results dashboard + game log viewer (web UI)
- [ ] Phase 5 — Archidekt import

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

## Blockers (one-way-door items — none yet)

_(none — will appear here immediately if one comes up)_
