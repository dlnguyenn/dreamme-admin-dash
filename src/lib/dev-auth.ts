/**
 * Dev-only bypass for the shared-password gate, so the dashboard can be
 * loaded and visually checked on localhost without typing the team password.
 *
 * Two independent guards, BOTH must hold:
 *
 *  1. `process.env.NODE_ENV === "development"` — Next.js inlines this at build
 *     time, so in any production build (i.e. every Vercel deploy) this function
 *     compiles down to `return false` and the bypass is dead code. This is the
 *     guarantee; it cannot be re-enabled by a header, cookie, or query param.
 *  2. The page is actually served from a loopback host — so even a `next dev`
 *     server exposed on a LAN interface stays gated.
 *
 * Grants admin so admin-only tabs are reachable while developing.
 */
export function devAuthBypass(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
