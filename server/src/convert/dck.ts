import type { CardRef, NormalizedDeck } from "../types/deck.js";

// Converts a NormalizedDeck to Forge's .dck format. Format confirmed against
// Forge's own bundled Commander precons (see engine/NOTES.md and
// spec.json#deck_format) - section headers, "Name=" metadata line, and
// "<count> <name>|<set>|<collector number>" card lines.
//
// Card resolution: Forge's own deck-line parser (forge-core DeckRecognizer)
// is lenient - it accepts a bare "<count> <name>" line and resolves it to
// *some* legal printing of that card by name, in addition to the full
// "name|set|collectornum" form for an exact printing. So when a source only
// gives us a name (or we're not confident about its set/collector-number
// pair), we fall back to the name-only form rather than risk a line Forge's
// parser rejects outright. This defers "does this exact printing exist in
// Forge's card database" to Forge itself at sim time, rather than
// duplicating Forge's ~34k-card index in this pipeline.
//
// MDFCs (modal double-faced cards): sources like Moxfield report these with
// a combined "Front // Back" display name (confirmed against a real Moxfield
// export, e.g. "Needleverge Pathway // Pillarverge Pathway"), but Forge's
// card database indexes them by front-face name only. DeckRecognizer's name
// regex is lenient enough to accept the "/" characters rather than reject
// the line outright, so an unmodified combined name would silently fail to
// resolve instead of erroring. Strip to the front face before emitting.
function frontFaceName(name: string): string {
  const separatorIndex = name.indexOf(" // ");
  return separatorIndex === -1 ? name : name.slice(0, separatorIndex);
}

function cardLine(card: CardRef): string {
  const name = frontFaceName(card.name);
  if (card.setCode && card.collectorNumber) {
    return `${card.quantity} ${name}|${card.setCode.toUpperCase()}|${card.collectorNumber}`;
  }
  return `${card.quantity} ${name}`;
}

export function toDck(deck: NormalizedDeck): string {
  if (deck.commander.length === 0) {
    throw new Error(`Cannot convert "${deck.name}" to .dck: no commander specified`);
  }

  const lines: string[] = [];
  lines.push("[metadata]");
  lines.push(`Name=${deck.name}`);
  lines.push("[Avatar]");
  lines.push("");
  lines.push("[Commander]");
  for (const card of deck.commander) lines.push(cardLine(card));
  lines.push("[Main]");
  for (const card of deck.mainboard) lines.push(cardLine(card));
  lines.push("[Sideboard]");
  lines.push("");
  lines.push("[Planes]");
  lines.push("");
  lines.push("[Schemes]");
  lines.push("");
  lines.push("[Conspiracy]");
  lines.push("");
  lines.push("[Dungeon]");
  lines.push("");

  return lines.join("\n");
}
