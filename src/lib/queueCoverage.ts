/**
 * Which Doublespeed accounts have something going out today, and which don't.
 *
 * The nine-persona TikTok batch is only a fifth of the fleet — there are 56
 * accounts and the other 45 had no coverage anywhere in the dash, so an account
 * that quietly stopped being queued was invisible.
 *
 * GROUPING: derived from `gender` + `account_type`, both of which the REST API
 * returns. Doublespeed's own `account_groups` (face-forward / faceless / women
 * / men) is richer but is exposed ONLY through the MCP connector, which a
 * Vercel cron cannot call — so grouping on it would mean a hand-maintained
 * mirror table that silently goes stale the first time an account is regrouped.
 * gender+platform is always current and needs no upkeep; the trade is that the
 * labels are ours rather than the ones shown in Doublespeed.
 *
 * COVERED: the account has a post dated today (Eastern) in status `scheduled`
 * or `posted`. Accounts that legitimately post every other day will therefore
 * show as uncovered on their off day — that is a known false positive and the
 * honest one, since the alternative is a per-account cadence config nobody
 * would keep current.
 */

export interface FleetAccount {
  id: string;
  username: string;
  account_type: string | null;
  gender: string | null;
  status: string | null;
}

export interface FleetPost {
  status: string | null;
  post_time: string | null;
  account: { username: string | null; account_type: string | null } | null;
}

export interface QueueGroupAccount {
  handle: string;
  platform: string;
  covered: boolean;
}

export interface QueueGroup {
  key: string;
  label: string;
  total: number;
  covered: number;
  accounts: QueueGroupAccount[];
}

export interface QueueCoverage {
  /** Eastern date the coverage was judged against. */
  date: string;
  groups: QueueGroup[];
  totalAccounts: number;
  totalCovered: number;
}

/**
 * The partition. Order matters — an account lands in the first group it
 * matches, so faceless wins over its platform and the platform buckets only
 * collect what's left.
 *
 * Together these cover all 56 accounts exactly once: TikTok 11, Faceless 12,
 * Instagram 11, Facebook 11, YouTube 11.
 */
const GROUPS: { key: string; label: string; match: (a: FleetAccount) => boolean }[] = [
  {
    key: "tiktok-personas",
    label: "TikTok personas",
    match: (a) => a.account_type === "tiktok",
  },
  {
    key: "faceless",
    label: "Faceless",
    match: (a) => a.gender === "faceless",
  },
  {
    key: "instagram-personas",
    label: "Instagram personas",
    match: (a) => a.account_type === "instagram",
  },
  {
    key: "facebook",
    label: "Facebook",
    match: (a) => a.account_type === "facebook",
  },
  {
    key: "youtube",
    label: "YouTube",
    match: (a) => a.account_type === "youtube",
  },
];

/** Eastern calendar date of an ISO timestamp, matching the trial-day boundary. */
export function easternDayOf(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
}

/** Statuses that mean "this is handled" — already out, or definitely going. */
const COVERED_STATUS = new Set(["scheduled", "posted", "succeeded", "pending"]);

export function buildQueueCoverage(
  accounts: FleetAccount[],
  posts: FleetPost[],
  today: string,
): QueueCoverage {
  // A burned account is not a gap to fill — flagging it every day would train
  // us to ignore the whole panel.
  const live = accounts.filter((a) => a.status === "good" && a.username);

  const coveredHandles = new Set<string>();
  for (const p of posts) {
    const handle = p.account?.username;
    if (!handle) continue;
    if (!COVERED_STATUS.has((p.status ?? "").toLowerCase())) continue;
    if (!p.post_time) continue;
    if (easternDayOf(p.post_time) !== today) continue;
    coveredHandles.add(handle);
  }

  const groups: QueueGroup[] = [];
  const claimed = new Set<string>();

  for (const g of GROUPS) {
    const members = live.filter((a) => !claimed.has(a.id) && g.match(a));
    for (const a of members) claimed.add(a.id);
    if (members.length === 0) continue;

    const rows = members
      .map((a) => ({
        handle: a.username,
        platform: a.account_type ?? "unknown",
        covered: coveredHandles.has(a.username),
      }))
      // Uncovered first: the panel exists to show what's missing.
      .sort((x, y) =>
        x.covered === y.covered
          ? x.handle.localeCompare(y.handle)
          : x.covered
            ? 1
            : -1,
      );

    groups.push({
      key: g.key,
      label: g.label,
      total: rows.length,
      covered: rows.filter((r) => r.covered).length,
      accounts: rows,
    });
  }

  return {
    date: today,
    groups,
    totalAccounts: live.length,
    totalCovered: groups.reduce((s, g) => s + g.covered, 0),
  };
}
