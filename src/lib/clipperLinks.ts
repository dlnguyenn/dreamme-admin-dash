/**
 * Public /clip/<slug> link helpers. PURE — no env, no fetch, no Supabase, so
 * this is safe to import from client components (ClipperAdmin) as well as
 * from server code. Keep it that way: lib/clippers.ts holds the service-role
 * key and must never be pulled into a browser bundle.
 *
 * A clipper's dashboard lives at /clip/<code>-<token slice>, e.g. "mia-3f9a2b7c".
 * Readable enough to hand to a creator, still unguessable — which matters
 * because the code itself is PUBLIC by design (it's in their bio and their
 * videos) while the page shows earnings, conversions and payout history.
 *
 * Full legacy tokens still resolve, so links already handed out keep working.
 */

/** Hex chars of the token kept in the slug. 8 → 4.3e9 combinations. */
export const SLUG_TOKEN_LEN = 8;

export function clipperSlug(clipper: { code: string; token: string }): string {
  const code = (clipper.code || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const suffix = (clipper.token || "").slice(0, SLUG_TOKEN_LEN);
  return code ? `${code}-${suffix}` : suffix;
}

export interface ParsedSlug {
  /** Full legacy token, when the whole path segment is one. */
  token?: string;
  /** Vanity form: code + the leading slice of the token. */
  code?: string;
  tokenPrefix?: string;
}

/**
 * Parse a /clip/<segment> path. Returns null for anything malformed so the
 * caller can 404 without touching the database.
 */
export function parseClipSlug(segment: string): ParsedSlug | null {
  const s = (segment || "").trim();
  if (!s) return null;
  if (/^[a-f0-9]{16,64}$/i.test(s)) return { token: s.toLowerCase() };

  // Split on the LAST hyphen so codes containing hyphens still work.
  const cut = s.lastIndexOf("-");
  if (cut <= 0) return null;
  const code = s.slice(0, cut);
  const tokenPrefix = s.slice(cut + 1);
  if (!/^[a-z0-9-]{1,40}$/i.test(code)) return null;
  if (!new RegExp(`^[a-f0-9]{${SLUG_TOKEN_LEN},64}$`, "i").test(tokenPrefix)) return null;
  return { code: code.toUpperCase(), tokenPrefix: tokenPrefix.toLowerCase() };
}
