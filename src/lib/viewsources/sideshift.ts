/**
 * Sideshift view source — NOT IMPLEMENTED YET, deliberately.
 *
 * Sideshift is a second publishing platform we pay for ($99.99 -> $199.99/mo
 * since Aug 2025), but no API documentation, base URL, auth scheme or account
 * list has been provided, and nothing about it exists anywhere in either repo
 * beyond a Chase vendor line. Writing a speculative client against a guessed
 * request shape would be worse than none: it would look wired up, fail in a
 * cron nobody watches, and be harder to correct than to write.
 *
 * `configured()` returns false until SIDESHIFT_API_KEY exists, so the sync
 * cron skips this source and reports it as unconfigured rather than failing.
 * When the docs arrive, fill in listAccounts/listPosts against the same
 * ViewSource contract doublespeed.ts implements — nothing downstream changes.
 */
import type { SourceAccount, SourcePost, ViewSource } from "./types";

const KEY = process.env.SIDESHIFT_API_KEY ?? "";

const NOT_WIRED =
  "Sideshift has an API key set but no client implemented yet — " +
  "add the request shapes to src/lib/viewsources/sideshift.ts";

export const sideshiftSource: ViewSource = {
  key: "sideshift",

  // Stays false even once a key is present, because a key alone doesn't make
  // the calls below real. Flip this to `KEY !== ""` in the same change that
  // implements them.
  configured() {
    return false;
  },

  async listAccounts(): Promise<SourceAccount[]> {
    if (KEY) throw new Error(NOT_WIRED);
    return [];
  },

  async listPosts(): Promise<SourcePost[]> {
    if (KEY) throw new Error(NOT_WIRED);
    return [];
  },
};
