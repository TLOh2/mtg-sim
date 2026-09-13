# Forge integration notes (Phase 0 findings)

Working notes on how Forge's CLI actually behaves, discovered while getting
Phase 0 working. Reference this before changing `run-sim.sh` or building the
Phase 2 pipeline wrapper.

## Build

- Only 5 of Forge's 11 Maven modules are needed for headless CLI sim mode:
  `forge-core`, `forge-game`, `forge-ai`, `forge-gui`, `forge-gui-desktop`.
  The rest (mobile/android/ios/adventure-editor/installer/lda) are for other
  front ends and slow the build substantially - excluded via `-pl`.
- Gotcha: this project uses Maven "CI-friendly versions" (`${revision}` in
  `pom.xml`) normalized by `flatten-maven-plugin` - but that plugin's
  execution is bound to the `deploy` phase, not `install`. A plain
  `mvn -pl <modules> -am install` compiles and installs jars fine, but the
  *installed POMs* still contain the literal, unresolved `${revision}`
  string as their parent version. Any later, separate Maven invocation that
  needs to resolve those POMs from the local repo (e.g.
  `mvn dependency:build-classpath` run against just `forge-gui-desktop`)
  fails with `forge:forge:pom:${revision} (absent)`.
  - Fix used here: `mvn -N install` once at the repo root installs a
    correctly-versioned parent POM; and the classpath-generation step also
    runs with `-am` so it resolves everything from the live reactor instead
    of only the local repo. See `engine/build.sh`.

## CLI sim mode (`forge.view.Main` → `forge.view.SimulateMatch`)

- Entry point: `java forge.view.Main sim -d <deck...> -f <format> -n <games> ...`
  (see Forge's own `argumentHelp()` in `SimulateMatch.java` for the full flag
  list; also summarized in `spec.json` under `engine.cli_flags`).
- **Deck paths are not arbitrary file paths.** `-d <name>` only works two ways:
  1. `name` is a deck already known to Forge's own deck storage (looked up by
     name), or
  2. `name` ends in a 3-character extension (e.g. `.dck`) and is **relative
     to** Forge's own deck directory (`$HOME/.forge/decks/commander/` for
     Commander, `.../constructed/` otherwise) - Forge does a literal string
     concatenation of `baseDir + name`, so an absolute path does not work and
     silently fails with "Could not load deck - ..., match cannot start".
  - `-D <directory>` (an arbitrary absolute deck directory) exists but is
    **only wired up in tournament mode** (`-t`), not the normal player-match
    path we use.
  - Our workaround (`engine/run-sim.sh`): stage the real `.dck` files (wherever
    they actually live, e.g. pipeline output) into a run-scoped subdirectory
    under `$HOME/.forge/decks/commander/<run-id>/`, then pass
    `<run-id>/<filename>.dck` as the relative deck reference. Subdirectories
    work fine since it's just string concatenation.
- Headless: pass `-Djava.awt.headless=true` on the JVM command line (Forge's
  own `Main.main` also sets this automatically for `sim`/`parse`/`server`
  modes if not already set, but before the display would ever be touched).
- Per-game safety timeout: `-c <seconds>` (Forge's own default is 120s if
  omitted). This is Forge's internal "call it a draw if it takes too long"
  clock, not a wall-clock wrapper we add ourselves. A real 4-player Commander
  game observed in testing took ~124s of wall time (turn 30) - so Phase 2's
  batch runner should budget generously (e.g. `-c 300`) rather than relying on
  Forge's 120s default, and should NOT additionally wrap invocations in a
  tight external timeout.

## Observed log line shapes (stdout, non-`-q` mode)

Useful for scoping the Phase 3 parser. Each line is one `GameLogEntry`; common
prefixes seen in a real 4-player game:

```
Turn: Turn 2 (Ai(1)-Starter Commander - Red)
Phase: Ai(1)-Starter Commander - Red's Main phase, precombat
Land: Ai(1)-Starter Commander - Red played Mountain (76)
Mana: Mountain (76) - {T}: Add {R}.
Add To Stack: Ai(1)-Starter Commander - Red cast Goblin Bushwhacker
Resolve Stack: Goblin Bushwhacker - Creature 1 / 1
Combat: Ai(3)-Starter Commander - Black assigned Arbiter of Woe (293), ... to attack Ai(2)-Starter Commander - Blue.
Damage: Arbiter of Woe (293) deals 5 damage to Animating Faerie (136).
Life: Life: Ai(2)-Starter Commander - Blue 8 > 1
Zone Change: Gray Merchant of Asphodel (212) was put into Graveyard from Battlefield.
Player Control: Ai(1)-Starter Commander - Red has restored control over themself
Game Outcome: Ai(3)-Starter Commander - Black has won because all opponents have lost
Match Result: Ai(1)-Starter Commander - Red: 0 Ai(2)-Starter Commander - Blue: 0 Ai(3)-Starter Commander - Black: 1 Ai(4)-Starter Commander - Green: 0
```

Plus a final synthesized (not a `GameLogEntry`) summary line printed by
`SimulateMatch` itself:

```
Game Result: Game 1 ended in 124286 ms. Ai(3)-Starter Commander - Black has won!
```

Forge's `GameLogEntryType` enum (in `forge-game`) is the authoritative
category list - Phase 3's parser should classify against that enum rather
than re-deriving categories from prefix strings, which are just this display
formatting.

## Validated end to end

- 1v1 (2 decks): real placeholder Commander precons, `-n 1 -q`, ~22s, real
  winner reported.
- 4-player pod (spec's default pod size): same precons ×4, full (non-`-q`)
  log, one full game completed in ~124s (turn 30) with realistic combat,
  deaths, and a clean `Game Outcome`/`Match Result`/`Game Result` sequence.
