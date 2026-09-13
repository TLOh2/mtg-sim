// Fetches Moxfield deck JSON directly from the browser, not the server.
//
// Why: the server (deployed on Render) got 403'd by Moxfield's API on every
// request, even after sending browser-like headers - almost certainly
// TLS/network-level bot detection (a datacenter IP, or a fingerprint that
// doesn't match a real browser's TLS handshake), not something a spoofed
// User-Agent string fixes. A real browser making this request is the
// legitimate way around that: it's not impersonating anything, it's an
// actual browser, with its own real headers/TLS fingerprint that the
// server-side fetch could never replicate. See PROGRESS.md.
const API_BASE = "https://api2.moxfield.com/v3/decks/all";

export function extractMoxfieldPublicId(deckUrl: string): string {
  const match = deckUrl.match(/moxfield\.com\/decks\/([^/?#]+)/i);
  if (!match) {
    throw new Error(`Not a recognizable Moxfield deck URL: ${deckUrl}`);
  }
  return match[1];
}

export async function fetchMoxfieldDeckClientSide(deckUrl: string): Promise<unknown> {
  const publicId = extractMoxfieldPublicId(deckUrl);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${publicId}`, { headers: { Accept: "application/json" } });
  } catch {
    // The browser deliberately hides the real reason for a cross-origin
    // fetch failure (could be CORS, could be a network error) - this is as
    // specific as client-side code can be. Check the browser's own
    // devtools console/network tab for the actual reason if this happens.
    throw new Error(
      "your browser couldn't reach Moxfield's API directly (could be blocked by CORS - " +
        "check your browser's devtools console for the real reason)",
    );
  }
  if (!res.ok) {
    throw new Error(`Moxfield returned ${res.status} ${res.statusText} for deck ${publicId}`);
  }
  return res.json();
}
