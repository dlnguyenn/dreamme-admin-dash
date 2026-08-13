/**
 * Which of today's drafts the "queue all" button is allowed to touch.
 *
 * Pure and separately testable on purpose: everything here decides what gets
 * PUBLISHED to live accounts, and the failure mode is not a wrong pixel, it is
 * a post going out that should not have. The route must never take a list of
 * ids from the client — it calls this with the live API state and uses what
 * comes back.
 */
import type { LivePost } from "@/lib/batchState";
import { easternDayOf } from "@/lib/morningDiscovery";
import { MORNING_ACCOUNTS } from "@/lib/morningPosts";

export interface QueueAccount {
  username: string;
  platform: string;
  setKey: string;
}

/**
 * The queue roster is WIDER than the display roster. The Overview panel shows
 * Facebook and Instagram only, but every set also posts to YouTube, and a
 * button that queued just the two visible platforms would quietly leave the
 * YouTube drafts to rot — which is exactly how the 2026-08-06 faceless
 * YouTube leftovers happened.
 */
export const QUEUE_ACCOUNTS: QueueAccount[] = [
  ...MORNING_ACCOUNTS.map((a) => ({ ...a, platform: a.platform as string })),
  { username: "hannahglp1", platform: "youtube", setKey: "hannah" },
  { username: "oliviaglp1", platform: "youtube", setKey: "olivia" },
  { username: "mikaylaglp1", platform: "youtube", setKey: "mikayla" },
  { username: "glp1_tips", platform: "youtube", setKey: "glp1_tips" },
  { username: "glp1_tips_tricks", platform: "youtube", setKey: "glp1_tips_tricks" },
  { username: "glp1hacks", platform: "youtube", setKey: "glp1hacks" },
  { username: "dreammeglp1tips", platform: "youtube", setKey: "julie_glp1" },
  // two-beat lane's YouTube surfaces. FB/IG arrive via MORNING_ACCOUNTS above.
  { username: "glp1mia", platform: "youtube", setKey: "mia" },
  { username: "angelaglp1", platform: "youtube", setKey: "angela" },
  { username: "brittanyglp1", platform: "youtube", setKey: "brittany" },
];

/**
 * Captions that are themselves an instruction not to publish. There are 14 of
 * these sitting in drafts right now; queueing one would post the literal words
 * "DO NOT PUBLISH" or "MUSICTEST … delete me" to a live account.
 */
export const BLOCKLIST =
  /DO NOT PUBLISH|MUSICTEST|SOUNDTEST|MUSIC ATTACHMENT TEST|DELETE ME/i;

export interface QueueTarget {
  id: string;
  setKey: string;
  username: string;
  platform: string;
  title: string;
}

export interface QueueSkip {
  id: string;
  username: string | null;
  reason: string;
  title: string;
}

export interface QueueSelection {
  targets: QueueTarget[];
  skipped: QueueSkip[];
}

/**
 * @param posts  every post the live API returned, with its derived state
 * @param today  Eastern calendar day, "YYYY-MM-DD"
 */
export function selectQueueTargets(
  posts: LivePost[],
  today: string,
  accounts: QueueAccount[] = QUEUE_ACCOUNTS,
): QueueSelection {
  const roster = new Map(
    accounts.map((a) => [`${a.username.toLowerCase()}|${a.platform}`, a.setKey]),
  );

  // What is already live or queued on each account, by caption. A draft whose
  // caption already went out on that account is a duplicate, not a new post.
  const spokenFor = new Map<string, Set<string>>();
  for (const p of posts) {
    if (p.derived === "draft") continue;
    const acct = `${(p.username ?? "").toLowerCase()}|${p.accountType}`;
    if (!spokenFor.has(acct)) spokenFor.set(acct, new Set());
    spokenFor.get(acct)!.add((p.title ?? "").trim().slice(0, 120));
  }

  const targets: QueueTarget[] = [];
  const skipped: QueueSkip[] = [];
  const add = (p: LivePost, reason: string) =>
    skipped.push({
      id: p.id,
      username: p.username,
      reason,
      title: (p.title ?? "").slice(0, 80),
    });

  for (const p of posts) {
    if (p.derived !== "draft") continue; // only drafts are queueable at all

    const key = `${(p.username ?? "").toLowerCase()}|${p.accountType}`;
    const setKey = roster.get(key);
    if (!setKey) continue; // not a roster account: silently out of scope

    const title = (p.title ?? "").trim();

    if (p.deleteRequested) {
      add(p, "deletion requested");
      continue;
    }
    if (BLOCKLIST.test(title)) {
      add(p, "caption is a do-not-publish / test marker");
      continue;
    }
    if (easternDayOf(p.succeededAt ?? p.postTime) !== today) {
      add(p, "not created today");
      continue;
    }
    if (spokenFor.get(key)?.has(title.slice(0, 120))) {
      add(p, "same caption already live on this account");
      continue;
    }

    targets.push({
      id: p.id,
      setKey,
      username: p.username ?? "",
      platform: p.accountType ?? "",
      title: title.slice(0, 80),
    });
  }

  return { targets, skipped };
}

/**
 * Undo. Only posts this button could legitimately have queued are eligible:
 * currently scheduled, on a roster account, dated today, and named by the
 * caller. The id list is checked against live state rather than trusted.
 */
export function selectUnqueueTargets(
  posts: LivePost[],
  ids: string[],
  today: string,
  accounts: QueueAccount[] = QUEUE_ACCOUNTS,
): QueueTarget[] {
  const wanted = new Set(ids);
  const roster = new Map(
    accounts.map((a) => [`${a.username.toLowerCase()}|${a.platform}`, a.setKey]),
  );
  const out: QueueTarget[] = [];
  for (const p of posts) {
    if (!wanted.has(p.id)) continue;
    if (p.derived !== "scheduled") continue; // already posted, or never queued
    const key = `${(p.username ?? "").toLowerCase()}|${p.accountType}`;
    const setKey = roster.get(key);
    if (!setKey) continue;
    if (easternDayOf(p.succeededAt ?? p.postTime) !== today) continue;
    out.push({
      id: p.id,
      setKey,
      username: p.username ?? "",
      platform: p.accountType ?? "",
      title: (p.title ?? "").slice(0, 80),
    });
  }
  return out;
}
