// Phase 5 (Archidekt import) is NOT implemented, deliberately.
//
// spec.json flags Archidekt's export shape as an explicit open question and
// says to resolve it empirically against a real deck URL rather than guess
// (spec.json#deck_sources.archidekt.do_not_guess). This session's network
// egress policy blocks archidekt.com entirely (confirmed via curl and the
// WebFetch tool - same restriction documented for Moxfield in PROGRESS.md's
// Phase 1 section), so that empirical step could not be done here.
//
// Unlike Moxfield (where the task's own framing treated the API shape as
// reasonably well-established and I built a best-effort importer against
// community documentation), guessing here would contradict spec.json's
// explicit instruction. So this is a stub, not a guess: implement
// fetchArchidektDeck/normalizeArchidektDeck the same way moxfield.ts does,
// once a real response has actually been inspected (see PROGRESS.md for
// what's needed to unblock this).
import type { NormalizedDeck } from "../types/deck.js";

export async function importArchidektDeck(_deckUrl: string): Promise<NormalizedDeck> {
  throw new Error(
    "Archidekt import is not implemented yet - its export shape is an open question " +
      "that needs checking against a real deck URL before writing this (see PROGRESS.md Phase 5).",
  );
}
