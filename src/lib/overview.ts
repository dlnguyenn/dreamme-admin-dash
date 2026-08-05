/**
 * Overview tab data assembly — everything the landing screen shows, fetched
 * server-side with the service role and returned as one payload.
 *
 * Design rule: no section may take down the page. Each fetcher is wrapped by
 * section(), which swallows the failure into `errors[]` and returns null, so a
 * dead RevenueCat sync still leaves you looking at support and today's batch.
 *
 * Per-file PostgREST helper, same convention as clippers.ts and support/db.ts.
 */
import { SUPABASE_URL } from "@/lib/supabase";
import { syncBatchPostState } from "@/lib/batchState";
import {
  dateWindow,
  easternDate,
  easternDateOffset,
  gainedSeries,
  isoDate,
  pickDailyMode,
  publishedSeries,
  sumSeries,
  VIEW_SOURCES,
  type DailyMode,
  type DailyPoint,
  type DailyViewsRow,
  type PublishDateRow,
} from "@/lib/socialViews";

const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export function overviewDbConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

async function sbGet<T>(path: string): Promise<T> {
  if (!overviewDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Exact row count without transferring rows (PostgREST Content-Range). */
async function sbCount(path: string): Promise<number> {
  if (!overviewDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "HEAD",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} counting ${path}`);
  const total = res.headers.get("content-range")?.split("/")[1];
  const n = Number(total);
  return Number.isFinite(n) ? n : 0;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Payload

export interface NorthStar {
  date: string | null;
  trialStartsYesterday: number | null;
  trialStartsToday: number | null;
  /** Sum over the last 7 COMPLETE days — today is excluded. */
  last7d: number | null;
  avg7d: number | null;
  deltaPct: number | null;
  spark: number[];
  /** RevenueCat's nightly rollup hasn't produced yesterday's row yet. */
  stale: boolean;
}

export interface RevenueSnapshot {
  date: string | null;
  mrr: number | null;
  activeSubscriptions: number | null;
}

export interface ViewsSection {
  /** false = no posts synced yet; the UI shows a "waiting for sync" state. */
  configured: boolean;
  mode: DailyMode;
  modeReason: string;
  cumulative: number;
  bySource: { source: string; views: number; posts: number }[];
  daily: DailyPoint[];
  snapshotSince: string | null;
  accounts: { active: number; total: number };
  platforms: string[];
}

export interface SupportSection {
  unreadCount: number;
  recent: {
    id: string;
    subject: string | null;
    from: string | null;
    at: string | null;
    category: string | null;
    urgency: string | null;
    unread: boolean;
  }[];
}

/** Live Doublespeed state for one batch post. */
export type BatchPostState =
  | "queued"
  | "posted"
  | "draft"
  | "failed"
  | "unknown";

export interface TodaySection {
  batchKey: string | null;
  batchDate: string | null;
  status: string | null;
  experiment: string | null;
  isToday: boolean;
  posts: {
    persona: string;
    hook: string | null;
    tier: string | null;
    engine: string | null;
    reviewUrl: string | null;
    postUrl: string | null;
    /**
     * "unknown" is a real answer: it means this row has not been verified
     * against Doublespeed yet, and it must NOT be collapsed into "queued".
     * Treating a write-once post id as current state is the bug this replaced,
     * which made a long-published batch read as 9/9 QUEUED forever.
     */
    state: BatchPostState;
    postedAt: string | null;
  }[];
}

export interface TopPost {
  id: string;
  title: string | null;
  persona: string | null;
  platform: string | null;
  handle: string | null;
  source: string | null;
  views: number;
  postedAt: string | null;
  url: string | null;
}

export interface PaidSection {
  date: string | null;
  spend: number | null;
  installs: number | null;
  cpi: number | null;
  trialStarts: number | null;
  costPerTrial: number | null;
  alerts: {
    id: string;
    severity: string;
    message: string;
    metric: string | null;
    campaignName: string | null;
  }[];
}

export interface OpsCheck {
  key: string;
  label: string;
  lastAt: string | null;
  ageHours: number | null;
  expectHours: number;
  state: "ok" | "late" | "missing";
}

export interface OverviewPayload {
  generatedAt: string;
  northStar: NorthStar | null;
  revenue: RevenueSnapshot | null;
  views: ViewsSection | null;
  support: SupportSection | null;
  today: TodaySection | null;
  topPosts: TopPost[] | null;
  paid: PaidSection | null;
  ops: OpsCheck[] | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Section fetchers

interface RcDailyRow {
  date: string;
  mrr: number | null;
  revenue: number | null;
  active_trials: number | null;
  active_subscriptions: number | null;
  trial_starts: number | null;
  trial_conversion_rate: number | null;
}

/**
 * North star + revenue share one read of rc_account_metrics_daily, so they're
 * fetched together and split afterwards.
 */
async function fetchRcDaily(): Promise<RcDailyRow[]> {
  const since = dateWindow(WINDOW_DAYS)[0];
  return sbGet<RcDailyRow[]>(
    `rc_account_metrics_daily?select=date,mrr,revenue,active_trials,active_subscriptions,trial_starts,trial_conversion_rate` +
      `&date=gte.${since}&order=date.asc&limit=${WINDOW_DAYS + 1}`,
  );
}

interface TrialStartsRow {
  date: string;
  trial_starts: number;
}

/**
 * Daily trial starts from the RevenueCat webhook feed (see migration 0058 for
 * why the rc_account_metrics_daily rollup can't be trusted for this — its
 * newest row is a mid-day snapshot and reads as a ~60% crash).
 */
async function fetchTrialStarts(): Promise<TrialStartsRow[]> {
  // Eastern, to match how migration 0060 buckets the view.
  const since = easternDateOffset(WINDOW_DAYS - 1);
  return sbGet<TrialStartsRow[]>(
    `rc_trial_starts_daily?select=date,trial_starts&date=gte.${since}&order=date.asc&limit=${WINDOW_DAYS + 1}`,
  );
}

export function buildNorthStar(rows: TrialStartsRow[] | null, now = new Date()): NorthStar {
  // Must be Eastern: the view groups by America/New_York, so asking for the UTC
  // date would read the wrong bucket for the last 4-5 hours of every day.
  const today = easternDate(now);
  const yesterday = easternDateOffset(1, now);

  if (!rows) {
    return {
      date: null,
      trialStartsYesterday: null,
      trialStartsToday: null,
      last7d: null,
      avg7d: null,
      deltaPct: null,
      spark: [],
      stale: true,
    };
  }

  const byDate = new Map(rows.map((r) => [r.date.slice(0, 10), Number(r.trial_starts)]));
  // Today is still accumulating, so it never enters the headline, the average,
  // or the sparkline — it only gets its own explicitly-live tile.
  const complete = rows
    .map((r) => ({ date: r.date.slice(0, 10), n: Number(r.trial_starts) }))
    .filter((r) => r.date < today);

  const value = byDate.get(yesterday) ?? null;

  // Compare against the 7 days before yesterday, not a window containing it —
  // otherwise a spike partly cancels itself out of its own baseline.
  const prior7 = complete.filter((r) => r.date < yesterday).slice(-7);
  const avg7d =
    prior7.length > 0 ? prior7.reduce((a, b) => a + b.n, 0) / prior7.length : null;

  const last7 = complete.slice(-7);

  return {
    date: value != null ? yesterday : (complete[complete.length - 1]?.date ?? null),
    trialStartsYesterday: value,
    trialStartsToday: byDate.get(today) ?? 0,
    last7d: last7.length > 0 ? last7.reduce((a, b) => a + b.n, 0) : null,
    avg7d: avg7d == null ? null : Math.round(avg7d * 10) / 10,
    deltaPct:
      value != null && avg7d != null && avg7d > 0
        ? Math.round(((value - avg7d) / avg7d) * 1000) / 10
        : null,
    spark: complete.slice(-14).map((r) => r.n),
    // No webhook events landed for yesterday at all — that's a broken pipeline,
    // not a quiet day.
    stale: value == null,
  };
}

/**
 * Only the STOCK measures are taken from rc_account_metrics_daily. MRR and the
 * active-subscription count are true at whatever moment RC was asked, so the
 * newest row is fine even though it's a mid-day snapshot (see 0058).
 *
 * Its other columns are deliberately NOT surfaced. The same row that carries a
 * correct $25,685 MRR reports active_trials = 0, and trial_conversion_rate
 * comes back as 8.75% — a figure that disagrees with the trial→paid rate the
 * team actually tracks (~38%), because RC computes it over a different cohort.
 * A number that looks authoritative and means something else is worse on a
 * landing screen than no number, so trial volume is shown instead, sourced
 * from rc_trial_starts_daily where the definition is ours and unambiguous.
 */
function buildRevenue(rows: RcDailyRow[]): RevenueSnapshot {
  const latest = rows[rows.length - 1] ?? null;
  return {
    date: latest?.date ?? null,
    mrr: num(latest?.mrr),
    activeSubscriptions: num(latest?.active_subscriptions),
  };
}

interface SocialPostRow {
  id: string;
  hook: string | null;
  persona: string | null;
  platform: string | null;
  handle: string | null;
  source: string | null;
  views: number | null;
  posted_at: string | null;
  post_url: string | null;
}

/**
 * Missing-table tolerance. Vercel serves the new bundle the moment the deploy
 * finishes, but the db-migrate workflow applies 0057 on its own schedule — so
 * there is a real window where this code runs against a schema without the
 * social_* tables. That window should read as "no views yet", which is true,
 * not as a red error banner.
 */
async function soft<T>(path: string, fallback: T): Promise<T> {
  try {
    return await sbGet<T>(path);
  } catch {
    return fallback;
  }
}

async function fetchViews(): Promise<ViewsSection> {
  const window = dateWindow(WINDOW_DAYS);
  const since = window[0];

  const [accounts, snapshotFirst, publishRows, dailyRows, windowPosts] =
    await Promise.all([
      soft<{ platform: string; active: boolean }[]>(
        `social_accounts?select=platform,active&limit=500`,
        [],
      ),
      soft<{ date: string }[]>(
        `social_post_views?select=date&order=date.asc&limit=1`,
        [],
      ),
      soft<PublishDateRow[]>(
        `social_posts_by_publish_date?select=date,source,views,posts&date=gte.${since}&order=date.asc&limit=500`,
        [],
      ),
      soft<DailyViewsRow[]>(
        `social_daily_views?select=date,source,cumulative_views,posts&date=gte.${since}&order=date.asc&limit=500`,
        [],
      ),
      soft<{ source: string; views: number | null }[]>(
        `social_posts?select=source,views&posted_at=gte.${since}T00:00:00Z&limit=5000`,
        [],
      ),
    ]);

  const snapshotSince = snapshotFirst[0]?.date?.slice(0, 10) ?? null;
  const { mode, reason } = pickDailyMode(snapshotSince, WINDOW_DAYS);
  const daily =
    mode === "gained"
      ? gainedSeries(dailyRows, window)
      : publishedSeries(publishRows, window);

  // Cumulative is always the sum of lifetime totals on posts published in the
  // window — a true "reach of the last 30 days of content" number that does
  // not depend on how much snapshot history exists.
  const bySource = VIEW_SOURCES.map((source) => {
    const rows = windowPosts.filter((p) => p.source === source);
    return {
      source,
      views: rows.reduce((s, p) => s + (Number(p.views) || 0), 0),
      posts: rows.length,
    };
  });

  const activeAccounts = accounts.filter((a) => a.active);
  return {
    configured: windowPosts.length > 0,
    mode,
    modeReason: reason,
    cumulative: bySource.reduce((s, b) => s + b.views, 0),
    bySource,
    daily,
    snapshotSince,
    accounts: { active: activeAccounts.length, total: accounts.length },
    platforms: [...new Set(activeAccounts.map((a) => a.platform))].sort(),
  };
}

interface SupportThreadLite {
  id: string;
  subject: string | null;
  counterpart_name: string | null;
  counterpart_email: string | null;
  category: string | null;
  urgency: string | null;
  unread: boolean;
  last_inbound_at: string | null;
}

async function fetchSupport(): Promise<SupportSection> {
  // Same filter as the sidebar badge in /api/support/threads, so the Overview
  // count and the nav count can never disagree.
  const [unread, recent] = await Promise.all([
    sbCount(`support_threads?select=id&unread=eq.true&status=not.in.(closed,ignored)`),
    sbGet<SupportThreadLite[]>(
      `support_threads?select=id,subject,counterpart_name,counterpart_email,category,urgency,unread,last_inbound_at` +
        `&status=not.in.(closed,ignored)&last_inbound_at=not.is.null` +
        `&order=last_inbound_at.desc&limit=5`,
    ),
  ]);

  return {
    unreadCount: unread,
    recent: recent.map((t) => ({
      id: t.id,
      subject: t.subject,
      from: t.counterpart_name || t.counterpart_email,
      at: t.last_inbound_at,
      category: t.category,
      urgency: t.urgency,
      unread: t.unread,
    })),
  };
}

interface BatchRow {
  batch_key: string;
  batch_date: string;
  status: string | null;
  experiment: string | null;
}

interface BatchPostRow {
  batch_key: string;
  persona: string;
  hook: string | null;
  tier: string | null;
  engine: string | null;
  review_url: string | null;
  doublespeed_post_id: string | null;
  post_status: string | null;
  posted_at: string | null;
  public_post_url: string | null;
  sort_order: number;
}

/**
 * Map Doublespeed's status vocabulary onto the four states the UI shows.
 * A row with an id but no synced status is UNKNOWN, never "queued" — that
 * conflation is what made a published batch report as still queued.
 */
function toBatchPostState(row: BatchPostRow): BatchPostState {
  if (!row.doublespeed_post_id) return "unknown";
  switch ((row.post_status ?? "").toLowerCase()) {
    case "scheduled":
    case "pending":
    case "queued":
      return "queued";
    case "posted":
    case "succeeded":
      return "posted";
    case "draft":
      // Queued then reverted to draft: it is NOT going out and never will
      // without intervention. Distinct from "failed" and from "unknown".
      return "draft";
    case "failed":
    case "error":
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Today's outgoing content. The batch row only exists once
 * claude/scripts/publish-batch-to-dash.py has run, so "no batch yet" is a
 * normal morning state, not an error — but the age of the newest batch is
 * exactly the signal worth surfacing, so we return it either way and let the
 * UI say whether it's today's.
 */
async function fetchToday(): Promise<TodaySection> {
  const batches = await sbGet<BatchRow[]>(
    `slideshow_batches?select=batch_key,batch_date,status,experiment&order=batch_date.desc,batch_no.desc&limit=1`,
  );
  const batch = batches[0];
  if (!batch) {
    return {
      batchKey: null,
      batchDate: null,
      status: null,
      experiment: null,
      isToday: false,
      posts: [],
    };
  }

  // Refresh live state before reading it. Non-fatal and rate-limited inside:
  // if Doublespeed is down or slow this returns an error and the rows simply
  // read as their last known state (or "unknown"), which is the honest answer.
  await syncBatchPostState({ batchKey: batch.batch_key });

  const posts = await sbGet<BatchPostRow[]>(
    `slideshow_batch_posts?select=batch_key,persona,hook,tier,engine,review_url,doublespeed_post_id,post_status,posted_at,public_post_url,sort_order` +
      `&batch_key=eq.${encodeURIComponent(batch.batch_key)}&order=sort_order.asc&limit=50`,
  );

  return {
    batchKey: batch.batch_key,
    batchDate: batch.batch_date,
    status: batch.status,
    experiment: batch.experiment,
    // >= not ===: batches are routinely built the night before and carry the
    // NEXT day's batch_date. Treating that as "nothing queued today" would
    // report a healthy pipeline as a miss.
    isToday: batch.batch_date >= isoDate(new Date()),
    posts: posts.map((p) => ({
      persona: p.persona,
      hook: p.hook,
      tier: p.tier,
      engine: p.engine,
      reviewUrl: p.review_url,
      postUrl: p.public_post_url,
      state: toBatchPostState(p),
      postedAt: p.posted_at,
    })),
  };
}

interface TikTokPostRow {
  id?: string;
  post_url: string;
  persona: string | null;
  view_count: number | null;
  posted_at: string | null;
  caption?: string | null;
}

/**
 * Best posts of the last 7 days. Prefers social_posts (all sources, all
 * platforms); falls back to tiktok_posts so the card says something real
 * before the view sync exists. The fallback is TikTok-only and its counts are
 * whatever the last scrape saw — flagged in the UI as such.
 */
async function fetchTopPosts(): Promise<TopPost[]> {
  const since = dateWindow(7)[0];
  // soft(): social_posts may not exist yet on a fresh deploy — fall through to
  // the TikTok scrape rather than blanking the card.
  const rows = await soft<SocialPostRow[]>(
    `social_posts?select=id,hook,persona,platform,handle,source,views,posted_at,post_url` +
      `&posted_at=gte.${since}T00:00:00Z&views=not.is.null&order=views.desc&limit=5`,
    [],
  );
  if (rows.length > 0) {
    return rows.map((r) => ({
      id: r.id,
      title: r.hook,
      persona: r.persona,
      platform: r.platform,
      handle: r.handle,
      source: r.source,
      views: Number(r.views) || 0,
      postedAt: r.posted_at,
      url: r.post_url,
    }));
  }

  const fallback = await sbGet<TikTokPostRow[]>(
    `tiktok_posts?select=post_url,persona,view_count,posted_at,caption` +
      `&posted_at=gte.${since}T00:00:00Z&order=view_count.desc&limit=5`,
  );
  return fallback.map((r) => ({
    id: r.post_url,
    title: r.caption?.split("\n")[0]?.slice(0, 120) ?? null,
    persona: r.persona,
    platform: "tiktok",
    handle: null,
    source: null,
    views: Number(r.view_count) || 0,
    postedAt: r.posted_at,
    url: r.post_url,
  }));
}

interface AdInsightRow {
  date: string;
  spend: number | null;
  installs: number | null;
  trial_starts: number | null;
}

interface AlertRow {
  id: string;
  severity: string;
  message: string;
  metric: string | null;
  campaign_name: string | null;
}

async function fetchPaid(): Promise<PaidSection> {
  const since = dateWindow(3)[0];
  const [insights, alerts] = await Promise.all([
    sbGet<AdInsightRow[]>(
      `ad_insights_daily?select=date,spend,installs,trial_starts&date=gte.${since}&order=date.desc&limit=1000`,
    ),
    sbGet<AlertRow[]>(
      `marketing_alerts?select=id,severity,message,metric,campaign_name` +
        `&resolved_at=is.null&order=created_at.desc&limit=5`,
    ),
  ]);

  // ad_insights_daily is one row per ad per day; roll up the most recent day
  // that actually has spend so a partially-synced today doesn't read as a
  // collapse in spend.
  const byDate = new Map<string, AdInsightRow[]>();
  for (const r of insights) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const day = [...byDate.keys()]
    .sort()
    .reverse()
    .find((d) => (byDate.get(d) ?? []).some((r) => Number(r.spend) > 0));

  const rows = day ? (byDate.get(day) ?? []) : [];
  const spend = rows.reduce((s, r) => s + (Number(r.spend) || 0), 0);
  const installs = rows.reduce((s, r) => s + (Number(r.installs) || 0), 0);
  const trialStarts = rows.reduce((s, r) => s + (Number(r.trial_starts) || 0), 0);

  return {
    date: day ?? null,
    spend: day ? spend : null,
    installs: day ? installs : null,
    cpi: installs > 0 ? spend / installs : null,
    trialStarts: day ? trialStarts : null,
    costPerTrial: trialStarts > 0 ? spend / trialStarts : null,
    alerts: alerts.map((a) => ({
      id: a.id,
      severity: a.severity,
      message: a.message,
      metric: a.metric,
      campaignName: a.campaign_name,
    })),
  };
}

/**
 * Pipeline health, derived from data freshness rather than a cron_runs table.
 *
 * The trade-off is deliberate: this detects "the job produced nothing", not
 * "the job threw an exception" — but in practice those overlap, and it costs
 * zero changes to the 17 existing cron routes. The failure this is really
 * guarding against is nothing going out and nobody noticing.
 */
const OPS_CHECKS: {
  key: string;
  label: string;
  path: string;
  field: string;
  expectHours: number;
}[] = [
  {
    key: "batch",
    label: "Daily batch published",
    path: "slideshow_batches?select=published_at&order=published_at.desc&limit=1",
    field: "published_at",
    expectHours: 30,
  },
  {
    key: "views",
    label: "Post view sync",
    path: "social_post_views?select=date&order=date.desc&limit=1",
    field: "date",
    expectHours: 30,
  },
  {
    key: "tiktok",
    label: "TikTok profile scrape",
    path: "tiktok_posts?select=last_scraped_at&order=last_scraped_at.desc&limit=1",
    field: "last_scraped_at",
    expectHours: 30,
  },
  {
    key: "support",
    label: "Support inbox poll",
    path: "support_messages?select=created_at&order=created_at.desc&limit=1",
    field: "created_at",
    expectHours: 48,
  },
  {
    key: "ads",
    label: "Meta ad insights",
    path: "ad_insights_daily?select=synced_at&order=synced_at.desc&limit=1",
    field: "synced_at",
    expectHours: 30,
  },
  {
    key: "rc",
    label: "RevenueCat sync",
    path: "rc_account_metrics_daily?select=synced_at&order=synced_at.desc&limit=1",
    field: "synced_at",
    expectHours: 30,
  },
];

async function fetchOps(): Promise<OpsCheck[]> {
  const now = Date.now();
  return Promise.all(
    OPS_CHECKS.map(async (c) => {
      let lastAt: string | null = null;
      try {
        const rows = await sbGet<Record<string, string | null>[]>(c.path);
        lastAt = rows[0]?.[c.field] ?? null;
      } catch {
        // A missing column or table is itself a "we don't know" answer, not a
        // reason to fail the whole Overview.
        lastAt = null;
      }
      if (!lastAt) {
        return { ...c, lastAt: null, ageHours: null, state: "missing" as const };
      }
      // Date-only fields (a `date` column) parse as UTC midnight, which reads
      // as up to 24h stale on the day it was written. Expected intervals above
      // are set wide enough (30h) to absorb that.
      const ts = new Date(
        lastAt.length === 10 ? `${lastAt}T00:00:00Z` : lastAt,
      ).getTime();
      const ageHours = (now - ts) / 3_600_000;
      return {
        key: c.key,
        label: c.label,
        expectHours: c.expectHours,
        lastAt,
        ageHours: Math.round(ageHours * 10) / 10,
        state: (ageHours <= c.expectHours ? "ok" : "late") as "ok" | "late",
      };
    }),
  );
}

// ---------------------------------------------------------------------------

async function section<T>(
  name: string,
  errors: string[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function buildOverview(): Promise<OverviewPayload> {
  const errors: string[] = [];

  const [rc, trialStarts, views, support, today, topPosts, paid, ops] =
    await Promise.all([
      section("revenuecat", errors, fetchRcDaily),
      section("trial-starts", errors, fetchTrialStarts),
      section("views", errors, fetchViews),
      section("support", errors, fetchSupport),
      section("today", errors, fetchToday),
      section("top-posts", errors, fetchTopPosts),
      section("paid", errors, fetchPaid),
      section("ops", errors, fetchOps),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    northStar: buildNorthStar(trialStarts),
    revenue: rc ? buildRevenue(rc) : null,
    views,
    support,
    today,
    topPosts,
    paid,
    ops,
    errors,
  };
}

export { sumSeries };
