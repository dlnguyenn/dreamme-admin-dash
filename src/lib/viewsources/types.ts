/**
 * One interface per publishing platform, so the view-sync cron never knows
 * which vendor it is talking to. Adding a third platform is one new file.
 *
 * Both vendors expose LIFETIME totals per post and nothing daily, which is why
 * the cron snapshots these numbers into social_post_views once a day and
 * src/lib/socialViews.ts derives the per-day series by diffing.
 */

export type ViewSourceKey = "doublespeed" | "sideshift";

/** Platforms we count. YouTube is deliberately out of scope for now. */
export type Platform = "tiktok" | "instagram" | "facebook" | "youtube";

export interface SourceAccount {
  externalId: string;
  handle: string;
  platform: Platform;
  /** Vendor status string; anything other than "good" seeds inactive. */
  status: string | null;
}

export interface SourcePost {
  sourcePostId: string;
  handle: string | null;
  platform: Platform;
  postUrl: string | null;
  postedAt: string | null;
  /** First line of the caption — the hook. */
  hook: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export interface ViewSource {
  readonly key: ViewSourceKey;
  /** False when the credential isn't configured; the cron skips the source. */
  configured(): boolean;
  listAccounts(): Promise<SourceAccount[]>;
  /** Posts published on or after `since`, with their lifetime view counts. */
  listPosts(since: Date): Promise<SourcePost[]>;
}

/** Vendor platform strings -> ours. Unknown values are dropped, not guessed. */
export function toPlatform(raw: string | null | undefined): Platform | null {
  switch ((raw ?? "").toLowerCase()) {
    case "tiktok":
      return "tiktok";
    case "instagram":
      return "instagram";
    case "facebook":
      return "facebook";
    case "youtube":
      return "youtube";
    default:
      return null;
  }
}

/** The hook is the first non-empty line of the caption. */
export function firstLine(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, 300) : null;
}
