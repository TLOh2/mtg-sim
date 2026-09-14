export interface DeckLibraryEntry {
  id: string;
  label: string;
  decklistText: string;
  /** Commander name(s), computed once at save time for display - not re-parsed on every list call. */
  commanderPreview?: string;
  savedAt: string;
}

/** What a run request picks for one player: an existing library deck, or fresh pasted text to save and use. */
export type DeckSelection = { deckId: string } | { label: string; decklistText: string };
