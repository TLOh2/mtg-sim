// Card art on hover for the replay view, per direct feedback: "add a
// Scryfall photo... I feel like a visual would just be so helpful here."
// Fetches Scryfall's free public API (no key needed) on demand and caches
// in memory for the life of the page - a person hovering cards one at a
// time is naturally well within Scryfall's own rate-limit guidance, and
// the cache means the same card is never re-fetched twice in one session.

const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

/** Scryfall's own front/back split - a split or MDFC card's fuzzy search wants just the front face name, not the full "A / B" as printed. */
function frontFaceName(cardName: string): string {
  return cardName.split(" / ")[0] ?? cardName;
}

interface ScryfallCard {
  image_uris?: { normal?: string };
  card_faces?: { image_uris?: { normal?: string } }[];
}

/** Resolves a card's Scryfall art URL, or null if it can't be found - never throws, since a missing image just means no preview, not a broken feature. */
export async function fetchScryfallImageUrl(cardName: string): Promise<string | null> {
  const key = frontFaceName(cardName);
  if (cache.has(key)) return cache.get(key)!;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(key)}`);
      if (!res.ok) {
        cache.set(key, null);
        return null;
      }
      const card = (await res.json()) as ScryfallCard;
      const url = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
      cache.set(key, url);
      return url;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
