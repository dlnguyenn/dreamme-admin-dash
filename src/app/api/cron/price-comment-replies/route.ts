/**
 * Price-comment auto-replier for live Meta ads.
 *
 * Every 15 min (GitHub Actions, .github/workflows/price-comment-replies.yml):
 *   1. ACTIVE ads in the account -> each ad's FB post (effective_object_story_id)
 *      and IG media (effective_instagram_media_id)
 *   2. comments from the last `hours` (default 72), minus ones already decided
 *      in ad_comment_replies
 *   3. Claude Haiku labels each as price / other (src/lib/price-comment-replies.ts)
 *   4. price + confidence >= 0.8 -> reply once as the DreamMe Page saying there
 *      is a free version; one reply per person per ad, at most `max` per run
 *
 *   5. a comment that names a competing app is hidden (never deleted; the
 *      commenter still sees it), status hidden
 *
 * Posting and hiding are OFF unless the Vercel env PRICE_REPLIES_LIVE is "true";
 * otherwise the run is a dry run that logs what it would have done (status
 * dry_run / would_hide) and returns it for review. ?dry_run=1 forces a dry run.
 *
 * Needs a Meta connection with Page + Instagram comment scopes (pages_show_list,
 * pages_read_engagement, pages_read_user_content, pages_manage_engagement,
 * instagram_basic, instagram_manage_comments). Until the connection has them,
 * the run returns 200 with waiting_for, so the cron stays green instead of
 * emailing every 15 minutes.
 *
 * Query params (the last three are for deliberate manual runs):
 *   ?dry_run=1, ?max=N replies per run (1..100)
 *   ?hours=N     lookback, 1..2160. Above 168 is a dry run unless ?backlog=1.
 *   ?backlog=1   allow acting on a long lookback: old price comments get the
 *                "update" wording, at most MAX_BACKLOG_PER_POST per post.
 *   ?announce=1  post the free-version announcement once, as a top-level Page
 *                comment, on every post that has comments (pin it by hand).
 *   ?reclassify=1  re-label comments decided by an older classifier (never
 *                ones already replied to or hidden).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { resolveMeta } from "@/lib/meta-resolve";
import { anthropicConfigured, callClaude, firstJson } from "@/lib/anthropic";
import {
  ANNOUNCEMENT,
  CLASSIFIER_SYSTEM,
  CLASSIFY_BATCH,
  INTENTS,
  IRREVERSIBLE,
  MAX_BACKLOG_PER_POST,
  MAX_LOOKBACK_HOURS,
  TERMINAL,
  classifierInput,
  commenterKey,
  decide,
  isLive,
  isOld,
  isTrivial,
  parseClassifications,
  type AdComment,
  type Classification,
  type Intent,
  type ReplyStatus,
} from "@/lib/price-comment-replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTERNAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const INTERNAL_KEY =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const API = process.env.META_API_VERSION ?? "v22.0";
const PAGE_ID = process.env.META_PAGE_ID ?? "935570636301545";
const IG_USER_ID = process.env.META_IG_USER_ID ?? "17841479655295639";
const HAIKU = "claude-haiku-4-5-20251001";
const IN_CHUNK = 150;

// ---------- Graph ----------
class GraphError extends Error {}

async function gGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${API}/${path}?${qs}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || body.error) throw new GraphError(`${path.split("?")[0]}: ${body.error?.message ?? res.status}`);
  return body;
}

async function gGetAll<T>(path: string, token: string, params: Record<string, string>, cap = 500): Promise<T[]> {
  const out: T[] = [];
  let page = await gGet<{ data?: T[]; paging?: { next?: string } }>(path, token, params);
  out.push(...(page.data ?? []));
  while (page.paging?.next && out.length < cap) {
    const res = await fetch(page.paging.next, { cache: "no-store" });
    page = (await res.json()) as { data?: T[]; paging?: { next?: string } };
    out.push(...(page.data ?? []));
  }
  return out;
}

async function gPost(path: string, token: string, params: Record<string, string>): Promise<{ id?: string }> {
  const res = await fetch(`https://graph.facebook.com/${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || body.error) throw new GraphError(`${path}: ${body.error?.message ?? res.status}`);
  return body;
}

// ---------- Supabase ----------
async function sbGet<T>(path: string): Promise<T[]> {
  const res = await fetch(`${INTERNAL_URL}/rest/v1/${path}`, {
    headers: { apikey: INTERNAL_KEY, Authorization: `Bearer ${INTERNAL_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

const inList = (vals: string[]) => `in.(${vals.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;

async function sbGetIn<T>(ids: string[], path: (list: string) => string): Promise<T[]> {
  const uniq = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) out.push(...(await sbGet<T>(path(inList(uniq.slice(i, i + IN_CHUNK))))));
  return out;
}

interface LogRow {
  comment_id: string;
  platform: "fb" | "ig";
  ad_id: string;
  ad_name: string;
  object_id: string;
  author_key: string | null;
  comment_text: string;
  comment_created_at: string;
  intent: string | null;
  confidence: number | null;
  status: ReplyStatus;
  reply_text: string | null;
  reply_id: string | null;
  error: string | null;
  processed_at: string;
}

async function upsertLog(rows: LogRow[]): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${INTERNAL_URL}/rest/v1/ad_comment_replies?on_conflict=comment_id`, {
    method: "POST",
    headers: {
      apikey: INTERNAL_KEY,
      Authorization: `Bearer ${INTERNAL_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`ad_comment_replies upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------- comment collection ----------
interface AdRow {
  id: string;
  name: string;
  creative?: { effective_object_story_id?: string; effective_instagram_media_id?: string };
}
interface FbComment {
  id: string;
  message?: string;
  created_time: string;
  is_hidden?: boolean;
  from?: { id: string };
  comments?: { data?: Array<{ from?: { id: string } }> };
}
interface IgComment {
  id: string;
  text?: string;
  timestamp: string;
  hidden?: boolean;
  username?: string;
  replies?: { data?: Array<{ username?: string }> };
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!INTERNAL_URL || !INTERNAL_KEY) {
    return NextResponse.json({ ok: false, error: "internal Supabase env missing" }, { status: 500 });
  }
  if (!anthropicConfigured()) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const url = new URL(req.url);
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(url.searchParams.get(k) ?? d);
    return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d;
  };
  const hours = num("hours", 72, 1, MAX_LOOKBACK_HOURS);
  const flag = (k: string) => url.searchParams.get(k) === "1";
  const backlog = flag("backlog");
  const announce = flag("announce");
  const reclassify = flag("reclassify");
  const live = isLive(process.env.PRICE_REPLIES_LIVE, url.searchParams.get("dry_run"), hours, backlog);
  const maxReplies = num("max", 30, 1, 100);
  const since = Date.now() - hours * 3_600_000;

  const meta = await resolveMeta();
  if (!meta) return NextResponse.json({ ok: false, live, waiting_for: "meta_connection" });

  // Page token (needs pages_show_list + a Page role). Missing = connection lacks Page scopes.
  let pageToken: string;
  try {
    const p = await gGet<{ access_token?: string }>(PAGE_ID, meta.token, { fields: "access_token" });
    if (!p.access_token) throw new GraphError("no Page access_token returned");
    pageToken = p.access_token;
  } catch (e) {
    return NextResponse.json({
      ok: false,
      live,
      waiting_for: "meta_page_permissions",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    let igUsername: string | null = null;
    let igError: string | null = null;
    try {
      igUsername = (await gGet<{ username?: string }>(IG_USER_ID, pageToken, { fields: "username" })).username ?? null;
    } catch (e) {
      igError = e instanceof Error ? e.message : String(e);
    }

    // 1. Active ads -> the posts/media their comments live on (several ads can share one).
    const ads = await gGetAll<AdRow>(`${meta.account}/ads`, meta.token, {
      effective_status: JSON.stringify(["ACTIVE"]),
      fields: "id,name,creative{effective_object_story_id,effective_instagram_media_id}",
      limit: "200",
    });
    const fbObjects = new Map<string, AdRow>();
    const igObjects = new Map<string, AdRow>();
    for (const ad of ads) {
      const s = ad.creative?.effective_object_story_id;
      const m = ad.creative?.effective_instagram_media_id;
      if (s && !fbObjects.has(s)) fbObjects.set(s, ad);
      if (m && !igObjects.has(m) && !igError) igObjects.set(m, ad);
    }

    // 2. Recent comments. Also note which posts have comments from other people
    // and which already carry our announcement (for ?announce=1).
    const comments: AdComment[] = [];
    const fetchErrors: string[] = [];
    const hasOthers = new Set<string>();
    const announced = new Set<string>();
    for (const [objectId, ad] of fbObjects) {
      try {
        const rows = await gGetAll<FbComment>(`${objectId}/comments`, pageToken, {
          fields: "id,message,created_time,is_hidden,from{id},comments.limit(25){from{id}}",
          filter: "stream",
          order: "reverse_chronological",
          limit: "100",
        }, 300);
        for (const c of rows) {
          const ours = c.from?.id === PAGE_ID;
          if (ours && c.message === ANNOUNCEMENT) announced.add(objectId);
          if (!ours) hasOthers.add(objectId);
          if (c.is_hidden || Date.parse(c.created_time) < since) continue;
          comments.push({
            platform: "fb",
            commentId: c.id,
            adId: ad.id,
            adName: ad.name,
            objectId,
            authorKey: c.from?.id ?? null,
            authorIsUs: c.from?.id === PAGE_ID,
            alreadyRepliedByUs: (c.comments?.data ?? []).some((r) => r.from?.id === PAGE_ID),
            text: c.message ?? "",
            createdTime: c.created_time,
          });
        }
      } catch (e) {
        fetchErrors.push(`fb ${objectId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const [objectId, ad] of igObjects) {
      try {
        const rows = await gGetAll<IgComment>(`${objectId}/comments`, pageToken, {
          fields: "id,text,timestamp,username,hidden,replies.limit(25){username}",
          limit: "100",
        }, 300);
        for (const c of rows) {
          const ours = !!igUsername && c.username === igUsername;
          if (ours && c.text === ANNOUNCEMENT) announced.add(objectId);
          if (!ours) hasOthers.add(objectId);
          if (c.hidden || Date.parse(c.timestamp) < since) continue;
          comments.push({
            platform: "ig",
            commentId: c.id,
            adId: ad.id,
            adName: ad.name,
            objectId,
            authorKey: c.username ?? null,
            authorIsUs: !!igUsername && c.username === igUsername,
            alreadyRepliedByUs: !!igUsername && (c.replies?.data ?? []).some((r) => r.username === igUsername),
            text: c.text ?? "",
            createdTime: c.timestamp,
          });
        }
      } catch (e) {
        fetchErrors.push(`ig ${objectId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Drop decided comments; reuse classifications from dry-run rows.
    const prior = await sbGetIn<{ comment_id: string; status: ReplyStatus; intent: string | null; confidence: number | null }>(
      comments.map((c) => c.commentId),
      (list) => `ad_comment_replies?select=comment_id,status,intent,confidence&comment_id=${list}`,
    );
    const priorById = new Map(prior.map((p) => [p.comment_id, p]));
    // ?reclassify=1 reopens everything we have not already acted on.
    const closed = reclassify ? IRREVERSIBLE : TERMINAL;
    const open = comments.filter((c) => !closed.has(priorById.get(c.commentId)?.status as ReplyStatus));

    const repliedRows = await sbGetIn<{ ad_id: string; author_key: string | null }>(
      ads.map((a) => a.id),
      (list) => `ad_comment_replies?select=ad_id,author_key&status=eq.replied&author_key=not.is.null&ad_id=${list}`,
    );
    const repliedCommenters = new Set(repliedRows.map((r) => commenterKey(r.ad_id, r.author_key as string)));

    const cls = new Map<string, Classification>();
    for (const c of open) {
      const p = priorById.get(c.commentId);
      if (p?.intent && !reclassify && (INTENTS as readonly string[]).includes(p.intent)) {
        cls.set(c.commentId, { intent: p.intent as Intent, confidence: p.confidence ?? 0 });
      }
      else if (isTrivial(c.text)) cls.set(c.commentId, { intent: "other", confidence: 1 });
    }
    const toClassify = open.filter((c) => !cls.has(c.commentId) && !c.authorIsUs);
    for (let i = 0; i < toClassify.length; i += CLASSIFY_BATCH) {
      const batch = toClassify.slice(i, i + CLASSIFY_BATCH).map((c) => ({ id: c.commentId, text: c.text }));
      const text = await callClaude({
        model: HAIKU,
        system: CLASSIFIER_SYSTEM,
        content: [{ type: "text", text: classifierInput(batch) }],
        maxTokens: 4096,
      });
      for (const [id, v] of parseClassifications(firstJson(text), batch.map((b) => b.id))) cls.set(id, v);
    }

    // 4. Decide, then (live only) reply or hide. Oldest first, capped per run;
    // a backlog run goes newest first and answers a few old comments per post.
    const nowMs = Date.now();
    open.sort((a, b) => (Date.parse(a.createdTime) - Date.parse(b.createdTime)) * (backlog ? -1 : 1));
    const now = new Date(nowMs).toISOString();
    const rows: LogRow[] = [];
    const backlogPerPost = new Map<string, number>();
    let posted = 0;
    let hidden = 0;
    let deferred = 0;
    let held = 0;
    for (const c of open) {
      const k = cls.get(c.commentId);
      const d = decide(c, k, repliedCommenters, nowMs);
      if (!d) continue; // unclassified (Claude skipped it): retry next tick
      const release = () => {
        if (c.authorKey) repliedCommenters.delete(commenterKey(c.adId, c.authorKey));
      };
      const base = {
        comment_id: c.commentId,
        platform: c.platform,
        ad_id: c.adId,
        ad_name: c.adName,
        object_id: c.objectId,
        author_key: c.authorKey,
        comment_text: c.text.slice(0, 2000),
        comment_created_at: c.createdTime,
        intent: k?.intent ?? null,
        confidence: k?.confidence ?? null,
        reply_text: null as string | null,
        reply_id: null as string | null,
        error: null as string | null,
        processed_at: now,
      };
      if (d.status === "hidden") {
        if (!live) {
          rows.push({ ...base, status: "would_hide" });
          continue;
        }
        if (hidden >= maxReplies) {
          deferred++;
          continue;
        }
        try {
          await gPost(c.commentId, pageToken, c.platform === "fb" ? { is_hidden: "true" } : { hide: "true" });
          hidden++;
          rows.push({ ...base, status: "hidden" });
        } catch (e) {
          rows.push({ ...base, status: "error", error: e instanceof Error ? e.message : String(e) });
        }
        continue;
      }
      if (d.status !== "replied") {
        rows.push({ ...base, status: d.status });
        continue;
      }
      // Old comments: a few per post, so one thread never fills with our replies.
      if (backlog && isOld(c, nowMs)) {
        const n = backlogPerPost.get(c.objectId) ?? 0;
        if (n >= MAX_BACKLOG_PER_POST) {
          held++;
          release();
          rows.push({ ...base, status: "dry_run" }); // no reply_text = held back
          continue;
        }
        backlogPerPost.set(c.objectId, n + 1);
      }
      if (!live) {
        rows.push({ ...base, status: "dry_run", reply_text: d.reply ?? null });
        continue;
      }
      if (posted >= maxReplies) {
        deferred++;
        release();
        continue;
      }
      try {
        const res = await gPost(
          c.platform === "fb" ? `${c.commentId}/comments` : `${c.commentId}/replies`,
          pageToken,
          { message: d.reply ?? "" },
        );
        posted++;
        rows.push({ ...base, status: "replied", reply_text: d.reply ?? null, reply_id: res.id ?? null });
      } catch (e) {
        release();
        rows.push({ ...base, status: "error", reply_text: d.reply ?? null, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 5. ?announce=1: one top-level comment from the Page on each post that has
    // comments from other people. Skipped where the text is already there or a
    // previous run logged it, so re-running never posts it twice.
    let announcedNow = 0;
    if (announce) {
      const targets = [
        ...[...fbObjects].map(([objectId, ad]) => ({ platform: "fb" as const, objectId, ad })),
        ...[...igObjects].map(([objectId, ad]) => ({ platform: "ig" as const, objectId, ad })),
      ].filter((t) => hasOthers.has(t.objectId) && !announced.has(t.objectId));
      const done = await sbGetIn<{ comment_id: string }>(
        targets.map((t) => `announce:${t.objectId}`),
        (list) => `ad_comment_replies?select=comment_id&status=eq.replied&comment_id=${list}`,
      );
      const doneIds = new Set(done.map((r) => r.comment_id));
      for (const t of targets) {
        const id = `announce:${t.objectId}`;
        if (doneIds.has(id)) continue;
        const base = {
          comment_id: id,
          platform: t.platform,
          ad_id: t.ad.id,
          ad_name: t.ad.name,
          object_id: t.objectId,
          author_key: null,
          comment_text: "",
          comment_created_at: now,
          intent: "announcement",
          confidence: null,
          reply_text: ANNOUNCEMENT,
          reply_id: null as string | null,
          error: null as string | null,
          processed_at: now,
        };
        if (!live) {
          rows.push({ ...base, status: "dry_run" });
          continue;
        }
        try {
          const res = await gPost(`${t.objectId}/comments`, pageToken, { message: ANNOUNCEMENT });
          announcedNow++;
          rows.push({ ...base, status: "replied", reply_id: res.id ?? null });
        } catch (e) {
          rows.push({ ...base, status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    await upsertLog(rows);

    const tally: Record<string, number> = {};
    for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
    const review = rows
      .filter((r) => r.intent === "price" || ["dry_run", "replied", "would_hide", "hidden"].includes(r.status))
      .slice(0, 80)
      .map((r) => ({
        platform: r.platform,
        ad: r.ad_name,
        comment: r.comment_text,
        intent: r.intent,
        confidence: r.confidence,
        status: r.status,
        reply: r.reply_text,
      }));

    return NextResponse.json({
      ok: fetchErrors.length === 0 && !rows.some((r) => r.status === "error"),
      live,
      hours,
      active_ads: ads.length,
      fb_posts: fbObjects.size,
      ig_media: igObjects.size,
      ...(igError ? { ig_error: igError } : {}),
      comments_seen: comments.length,
      open: open.length,
      classified_now: toClassify.length,
      ...(backlog ? { backlog } : {}),
      ...(reclassify ? { reclassify } : {}),
      posted,
      hidden,
      ...(announce ? { announced_now: announcedNow } : {}),
      deferred_by_cap: deferred,
      held_by_backlog_cap: held,
      statuses: tally,
      ...(fetchErrors.length ? { fetch_errors: fetchErrors.slice(0, 10) } : {}),
      review,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, live, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
