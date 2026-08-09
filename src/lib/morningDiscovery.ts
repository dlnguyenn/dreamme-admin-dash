/**
 * Find this morning's posts on the live Doublespeed API, without being told
 * about them.
 *
 * Why this exists: `morning_posts` is written only by a routine running
 * claude/scripts/publish-morning-posts.py. The deck routine was instructed to
 * do that from day one and never once did, so the four faceless sets showed as
 * "NOT CREATED" on the Overview every day while their posts were in fact going
 * out — 8 posts on 2026-08-06, 8 on 2026-08-07, all `posted`. A panel whose
 * whole job is "did the machines run" was answering no while they ran.
 *
 * Everything the panel needs is derivable without a manifest: live state from
 * filter membership (see batchState.collectDerived), the caption from `title`,
 * and a thumbnail from the post id. So the dash discovers, and the manifest
 * becomes an enrichment rather than the source of truth.
 *
 * Pure — no fetch, no dates-from-now. Callers supply the posts and today.
 *
 * One asymmetry worth knowing: discovery's notion of "today" is the post's own
 * Eastern slot day, while `morning_posts.batch_date` is the Eastern day the
 * routine ran. Those agree in the normal case and can only ever disagree by
 * adding a tile, never by corrupting one, because DB rows win on identity.
 */
import type { LivePost } from "@/lib/batchState";
import {
  MORNING_PLATFORMS,
  worstState,
  type ExpectedSet,
  type MorningAccount,
  type MorningPlatform,
  type MorningPostRow,
  type MorningTileState,
} from "@/lib/morningPosts";

const RENDERS = "https://auth.doublespeed.ai/storage/v1/object/public/renders";

/** Eastern calendar day of an ISO timestamp, or null. */
export function easternDayOf(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

const toPlatform = (t: string | null): MorningPlatform | null =>
  (MORNING_PLATFORMS as string[]).includes(t ?? "")
    ? (t as MorningPlatform)
    : null;

/**
 * Media URLs for a discovered post.
 *
 * The two forms are mutually exclusive and this is the one thing that must not
 * be got wrong: `renders/<id>` is video/mp4 and 400s for a carousel, while
 * `renders/<id>/1` is image/jpeg and 400s for a video. Putting an mp4 in
 * `thumb_url` would render a broken <img> on every persona tile, so a video
 * set gets NO thumbnail here — the manifest is what supplies one.
 */
function media(id: string, kind: ExpectedSet["kind"]) {
  return kind === "carousel"
    ? { thumb_url: `${RENDERS}/${id}/1`, video_url: null }
    : { thumb_url: null, video_url: `${RENDERS}/${id}` };
}

export function discoverMorningRows(
  posts: LivePost[],
  accounts: MorningAccount[],
  expected: ExpectedSet[],
  today: string,
): MorningPostRow[] {
  const bySet = new Map(expected.map((e) => [e.setKey, e]));
  const account = new Map(
    accounts.map((a) => [`${a.username.toLowerCase()}|${a.platform}`, a.setKey]),
  );

  // (setKey, platform) -> every post that qualifies today
  const groups = new Map<string, { set: ExpectedSet; platform: MorningPlatform; posts: LivePost[] }>();

  for (const p of posts) {
    // A post Dan deleted still comes back in the `all` filter; resurrecting it
    // as QUEUED would be worse than showing nothing.
    if (p.deleteRequested) continue;

    const platform = toPlatform(p.accountType);
    if (!platform || !p.username) continue;

    const setKey = account.get(`${p.username.toLowerCase()}|${platform}`);
    if (!setKey) continue; // unrecognised account: dropped, never guessed
    const set = bySet.get(setKey);
    if (!set) continue;

    // date_from bounds the pull; it does not mean "today". Re-check in ET.
    if (easternDayOf(p.succeededAt ?? p.postTime) !== today) continue;

    const key = `${setKey}|${platform}`;
    if (!groups.has(key)) groups.set(key, { set, platform, posts: [] });
    groups.get(key)!.posts.push(p);
  }

  const rows: MorningPostRow[] = [];
  for (const { set, platform, posts: group } of groups.values()) {
    // Worst state wins, not most recent — same invariant as worstState(): a
    // collapse must never hide the one that needs a person.
    const worst = worstState(group.map((p) => p.derived as MorningTileState));
    const candidates = group.filter((p) => p.derived === worst);
    const winner = candidates.reduce((a, b) =>
      (Date.parse(b.succeededAt ?? b.postTime ?? "") || 0) >
      (Date.parse(a.succeededAt ?? a.postTime ?? "") || 0)
        ? b
        : a,
    );

    rows.push({
      batch_date: today,
      routine: set.routine,
      set_key: set.setKey,
      platform,
      username: winner.username,
      doublespeed_post_id: winner.id,
      post_kind: set.kind,
      caption: winner.title,
      // The REST API exposes no sound. Absent, not empty — the UI says so.
      sound: null,
      ...media(winner.id, set.kind),
      // Discovery genuinely does not know how it was created; post_status
      // carries the live truth and toMorningState reads that first.
      created_status: "",
      post_status: winner.derived,
      posted_at: winner.succeededAt ?? winner.postTime,
      public_post_url: winner.publicPostUrl,
      discovered: true,
      extra_posts: group.length - 1,
    });
  }
  return rows;
}

/**
 * DB rows win; discovery fills the gaps.
 *
 * Three rules on (set_key, platform):
 *   1. DB only        -> the DB row
 *   2. discovery only -> the discovered row   <- the entire faceless bug
 *   3. both           -> the DB row wholesale (thumb, sound, caption, kind all
 *                        survive), EXCEPT that when the two describe the same
 *                        post, the live state overrides the stored one.
 *
 * Rule 3 is what makes syncMorningPostState an optimisation rather than
 * load-bearing: the panel is right even when the freshness gate skipped a sync.
 */
export function mergeMorningRows(
  dbRows: MorningPostRow[],
  discovered: MorningPostRow[],
): MorningPostRow[] {
  const key = (r: MorningPostRow) => `${r.set_key}|${r.platform}`;
  const live = new Map(discovered.map((r) => [key(r), r]));
  const out: MorningPostRow[] = [];

  for (const db of dbRows) {
    const d = live.get(key(db));
    if (d && d.doublespeed_post_id === db.doublespeed_post_id) {
      out.push({
        ...db,
        post_status: d.post_status,
        posted_at: d.posted_at,
        public_post_url: d.public_post_url,
        extra_posts: d.extra_posts,
      });
    } else {
      out.push(db);
    }
    live.delete(key(db));
  }
  // Whatever is left had no DB row at all.
  out.push(...live.values());
  return out;
}
