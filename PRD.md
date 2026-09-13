# Commander Simulator Platform — Product Requirements

> **Provenance note:** this document was not present in the repository at the
> start of implementation (the repo had zero commits). It was authored by
> Claude from the working task description plus direct research into the Forge
> game engine, to unblock development rather than stall waiting for it. Treat it
> as a first draft of intent, not a finalized decision record — see
> `PROGRESS.md` for what to double check.

## 1. Problem

Commander (EDH) players who brew or tune decks want to know, empirically, how a
deck performs against a specific group of other decks — not in theory, but
across many actual games. Doing this by hand (physically or on a client like
Forge) is slow: you can maybe play a handful of real games in an evening.

This platform automates that: take decklists people already have (on Moxfield,
and eventually Archidekt), convert them into a format a real rules-accurate MTG
engine can play, run a batch of simulated games between a pod of decks, and
turn the raw output into something a human can actually read — both an
aggregate view ("deck A won 8/20, usually by turn 11, usually via combat") and
a per-game replay/log view.

## 2. Why Forge

Building a Magic rules engine from scratch is a multi-year undertaking (the
comprehensive rules are enormous, and Commander adds its own layer: command
zone, commander tax, commander damage, color identity). [Forge](https://github.com/card-forge/forge)
is a mature, actively maintained, open-source Java engine that already:

- implements the full rules engine plus an AI capable of piloting a deck
  unattended,
- has first-class Commander format support (`GameType.Commander`,
  `RegisteredPlayer.forCommander`, command zone, commander damage, etc.),
- ships a CLI **sim mode** (`forge.view.Main` → `sim`) purpose-built for
  exactly this: headless, scriptable, batch simulation with a real game log
  and win/loss result, no display required,
- uses a plain-text `.dck` deck file format that's simple to generate
  programmatically.

This is the highest-risk dependency in the whole project — if Forge didn't
build headlessly or its AI couldn't reliably finish Commander games unattended,
the rest of this plan wouldn't be viable. Phase 0 exists specifically to prove
that risk out before anything else is built on top of it.

## 3. Users

A single player (or small group) tuning their own Commander decks, running
this locally. Not a hosted multi-tenant product — no auth, billing, or
multi-user concerns in scope.

## 4. Core workflow

1. Paste a Moxfield (later: Archidekt) deck URL for each deck in a pod (4
   decks, matching Commander's typical pod size).
2. The platform fetches each decklist, normalizes it into an internal
   representation, and converts it to Forge's `.dck` format — resolving each
   card to a printing Forge's card database actually has, since a raw
   Moxfield export can reference printings the engine doesn't know.
3. The platform invokes Forge's `sim` CLI with those four decks, `-f Commander`,
   and a batch size (default 20 games — see `spec.json`), and captures Forge's
   game log and per-game result.
4. The platform parses Forge's game log into structured events per game, and
   runs turning-point detection over each game's event stream (see the signal
   list in `spec.json`).
5. Results surface in a web dashboard: aggregate win rates and turning-point
   summaries across the batch, plus a per-game view that lets you step through
   one game's actual log.

## 5. Non-goals (for this iteration)

- Real-time/interactive play against the AI (this is batch simulation only).
- Deckbuilding or card legality checking beyond what's needed to run a sim.
- Support for formats other than Commander.
- Hosting/deployment concerns — this runs locally.

## 6. Phased delivery

See `spec.json` for the authoritative, structured version of scope per phase;
this section is the narrative rationale for the ordering.

**Phase 0 — Forge itself.** Prove the highest-risk dependency works before
investing in anything downstream: build Forge headless, invoke `sim` mode with
two real decks, get back a real winner and log. If this doesn't work, nothing
else matters yet.

**Phase 1 — Moxfield import.** Get real decklists in, in a normalized shape
decoupled from Moxfield's specific API response, then convert to `.dck`.
Validate against real Moxfield URLs, not just fixtures, since the main risk is
Moxfield's export shape and card-name/printing mismatches against Forge's
database.

**Phase 2 — Wire it together.** Take Phase 1's output and actually feed it
through Phase 0's proven Forge invocation, for a real 4-deck pod, a real batch
of games (default 20 per `spec.json`), and get real structured results back —
proving the whole pipeline works end to end before building any analysis or UI
on top of it.

**Phase 3 — Make the output legible.** Raw Forge logs are a wall of text.
Structure them into per-game event timelines, then layer turning-point
detection on top using the seed signal list in `spec.json` (this list is a
starting point, expected to be refined once real logs are in hand).

**Phase 4 — Dashboard.** Now that batches produce structured, analyzed
results, put a UI on it: an aggregate results view per batch/pod, and a
per-game log viewer.

**Phase 5 — Archidekt.** Second import source. Its exact export shape is an
open question — rather than guess, this phase validates against a real
Archidekt deck URL and documents what was actually found, the same way Phase 1
did for Moxfield.

## 7. Key risks (why this ordering)

1. **Forge headless build/CLI reliability** (Phase 0) — highest risk, proven
   first.
2. **Card resolution** — a Moxfield/Archidekt export names a specific printing
   (set + collector number); Forge's card database may not have that exact
   printing, or may name the card slightly differently. The converter needs a
   fallback strategy (match by name, pick *a* legal printing) rather than
   failing the whole import over one card.
3. **AI game completion** — Forge's AI needs to reliably finish a Commander
   game (4 players, no turn limit in principle) without stalling. `sim mode`
   has a `-c` clock/timeout flag specifically for this (defaults to 120s per
   game per Forge's own CLI help); Phase 0's smoke test should surface if this
   is a real problem before Phase 2 runs a full batch.
4. **Turning-point detection accuracy** — heuristic over free-text log lines,
   not a structured event API from Forge. Expect to iterate the signal list
   after seeing real logs (Phase 3 explicitly plans for this).
