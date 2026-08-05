/**
 * Daily organic view sync. For each configured publishing source: upsert the
 * account fleet, upsert posts with their LIFETIME view totals, then write one
 * snapshot row per post into social_post_views.
 *
 * The snapshot is the whole point — neither vendor exposes a daily series, so
 * views-gained-per-day only exists because this runs once a day and
 * socialViews.ts diffs consecutive dates. Re-running the same day upserts on
 * (post_id, date) rather than duplicating.
 *
 * Mirrors /api/cron/sync-clipper-views: chunked writes, per-chunk error
 * collection so one bad row can't take down the batch, and acceptViewUpdate()
 * guarding against public view badges that round down and bounce.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { acceptViewUpdate, todayISODate } from "@/lib/clipperSync";
import { SUPABASE_URL } from "@/lib/supabase";
import { doublespeedSource } from "@/lib/viewsources/doublespeed";
import { sideshiftSource } from "@/lib/viewsources/sideshift";
import type { SourcePost, ViewSource } from "@/lib/viewsources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCES: ViewSource[] = [doublespeedSource, sideshiftSource];

const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const CHUNK = 100;

/**
 * How far back to pull. Wider than the 30-day chart window on purpose: an
 * older post still accrues views, and if it isn't in today's snapshot its
 * contribution vanishes from the cumulative diff and shows up as a fake drop.
 */
const LOOKBACK_DAYS = 90;

function headers(extra?: Record<string, string>) {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function sbUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function chunked(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  errors: string[],
  label: string,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    try {
      await sbUpsert(table, slice, onConflict);
      ok += slice.length;
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message.slice(0, 150)}`);
    }
  }
  return ok;
}

interface ExistingPost {
  id: string;
  source_post_id: string;
  views: number | null;
}

async function syncSource(
  source: ViewSource,
  since: Date,
  today: string,
  errors: string[],
) {
  // 1) Accounts. Registered inactive when the vendor flags them (burned etc.)
  //    or when they're on a platform we deliberately don't count yet.
  const accounts = await source.listAccounts();
  if (accounts.length > 0) {
    await chunked(
      "social_accounts",
      accounts.map((a) => ({
        source: source.key,
        platform: a.platform,
        handle: a.handle,
        external_id: a.externalId,
        active: a.status === "good" && a.platform !== "youtube",
      })),
      // Keyed on the vendor's account id, not the handle: accounts get
      // renamed (glp1tips -> glp1tipss on 2026-08-05), and keying on handle
      // makes a rename look like a new account that then collides on
      // external_id.
      "source,external_id",
      errors,
      `${source.key} accounts`,
    );
  }

  // 2) Posts. Read back what we already hold so the never-decrease guard has
  //    a previous value to compare against.
  const posts = await source.listPosts(since);
  const existing = await sbGet<ExistingPost[]>(
    `social_posts?select=id,source_post_id,views&source=eq.${source.key}&limit=10000`,
  );
  const prevViews = new Map(existing.map((r) => [r.source_post_id, r.views]));

  let rejected = 0;
  const rows = posts.map((p: SourcePost) => {
    const prev = prevViews.get(p.sourcePostId);
    const accept = p.views != null && acceptViewUpdate(prev, p.views);
    if (p.views != null && !accept) rejected++;
    return {
      source: source.key,
      source_post_id: p.sourcePostId,
      platform: p.platform,
      handle: p.handle,
      post_url: p.postUrl,
      posted_at: p.postedAt,
      hook: p.hook,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      // Keep the stored (higher) number when the vendor reports a rounded-down
      // one; overwriting it makes counts visibly fall day to day.
      ...(accept ? { views: p.views, views_updated_at: new Date().toISOString() } : {}),
    };
  });

  const written = await chunked(
    "social_posts",
    rows,
    "source,source_post_id",
    errors,
    `${source.key} posts`,
  );

  // 3) Snapshot. Re-read to pick up ids for rows inserted a moment ago, and to
  //    snapshot the stored view count rather than the incoming one — those
  //    differ wherever the guard rejected an update.
  const after = await sbGet<ExistingPost[]>(
    `social_posts?select=id,source_post_id,views&source=eq.${source.key}&views=not.is.null&limit=10000`,
  );
  const inWindow = new Set(posts.map((p) => p.sourcePostId));
  const snapshots = after
    .filter((r) => inWindow.has(r.source_post_id))
    .map((r) => ({ post_id: r.id, date: today, views: r.views }));

  const snapped = await chunked(
    "social_post_views",
    snapshots,
    "post_id,date",
    errors,
    `${source.key} snapshots`,
  );

  return {
    source: source.key,
    accounts: accounts.length,
    posts: posts.length,
    postsWritten: written,
    snapshots: snapped,
    viewUpdatesRejected: rejected,
  };
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const today = todayISODate();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

  const errors: string[] = [];
  const skipped: string[] = [];
  const results = [];

  for (const source of SOURCES) {
    if (!source.configured()) {
      skipped.push(source.key);
      continue;
    }
    try {
      results.push(await syncSource(source, since, today, errors));
    } catch (e) {
      // One vendor being down must not cost us the other's snapshot — and a
      // missed day is a permanent hole in the diff series.
      errors.push(`${source.key}: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  return NextResponse.json({ ok: errors.length === 0, date: today, results, skipped, errors });
}
