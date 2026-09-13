// Mirrors the NormalizedDeck / CardRef shapes defined in spec.json#data_model.
// Kept deliberately decoupled from any single source's (Moxfield/Archidekt)
// response shape - each importer's job is to produce one of these.

export type DeckSourceType = "moxfield" | "archidekt";

export interface CardRef {
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  quantity: number;
}

export interface NormalizedDeck {
  sourceType: DeckSourceType;
  sourceUrl: string;
  name: string;
  commander: CardRef[];
  mainboard: CardRef[];
  fetchedAt: string;
}
