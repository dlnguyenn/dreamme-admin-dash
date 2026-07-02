/**
 * Growth AI — server-side data layer + Claude agent loop for the
 * "AI brain for marketing" tab (Motion/Runneth-style analyst).
 *
 * Everything here is READ-ONLY: the analyst can pull Meta ad performance
 * (cached ad_insights_daily), RevenueCat account metrics, and the blended
 * efficiency view, then reason over them. Ad writes stay in the Ads MCP
 * where they're confirm-gated.
 *
 * Reused by:
 *   - /api/growth/chat   (multi-turn agentic chat)
 *   - /api/growth/recap  (one-click weekly retro)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// --- small helpers ----------------------------------------------------------

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number): string {
  return ymd(new Date(Date.now() - n * 86_400_000));
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function r(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function div(a: number, b: number, decimals = 2): number | null {
  return b > 0 ? r(a / b, decimals) : null;
}

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase read failed (${path.split("?")[0]}): ${res.status}`);
  }
  return (await res.json()) as T[];
}

// --- raw reads --------------------------------------------------------------

interface AdRow {
  ad_id: string;
  date: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  effective_status: string | null;
  spend: string | number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: string | number;
  creative_name: string | null;
  message: string | null;
  headline: string | null;
  video_id: string | null;
  video_3sec_views: number | null;
  video_thruplays: number | null;
}

interface RcRow {
  date: string;
  mrr: string | number | null;
  revenue: string | number | null;
  active_subscriptions: number | null;
  active_trials: number | null;
  new_customers: number | null;
  trial_starts: number | null;
  trial_conversions: number | null;
  ltv_30d_per_paying_customer: string | number | null;
}

const AD_COLS =
  "ad_id,date,ad_name,adset_id,adset_name,campaign_id,campaign_name,effective_status," +
  "spend,impressions,clicks,installs,trial_starts,purchases,purchase_value," +
  "creative_name,message,headline,video_id,video_3sec_views,video_thruplays";

async function readAds(since: string, until: string): Promise<AdRow[]> {
  return sbSelect<AdRow>(
    `ad_insights_daily?select=${AD_COLS}&date=gte.${since}&date=lte.${until}&limit=20000`,
  );
}

async function readRc(since: string, until: string): Promise<RcRow[]> {
  return sbSelect<RcRow>(
    `rc_account_metrics_daily?select=*&date=gte.${since}&date=lte.${until}&order=date.desc&limit=400`,
  );
}

// --- aggregation ------------------------------------------------------------

export interface AdAgg {
  ad_id: string;
  ad_name: string;
  adset_name: string;
  campaign_name: string;
  effective_status: string;
  is_video: boolean;
  first_seen: string;
  last_active: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  v3: number;
  thru: number;
  headline: string;
  message: string;
}

function aggregateAds(rows: AdRow[]): AdAgg[] {
  const map = new Map<string, AdAgg>();
  for (const x of rows) {
    let a = map.get(x.ad_id);
    if (!a) {
      a = {
        ad_id: x.ad_id,
        ad_name: x.ad_name ?? "",
        adset_name: x.adset_name ?? "",
        campaign_name: x.campaign_name ?? "",
        effective_status: x.effective_status ?? "",
        is_video: !!x.video_id,
        first_seen: x.date,
        last_active: x.date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        trial_starts: 0,
        purchases: 0,
        v3: 0,
        thru: 0,
        headline: x.headline ?? "",
        message: x.message ?? "",
      };
      map.set(x.ad_id, a);
    }
    a.spend += num(x.spend);
    a.impressions += num(x.impressions);
    a.clicks += num(x.clicks);
    a.installs += num(x.installs);
    a.trial_starts += num(x.trial_starts);
    a.purchases += num(x.purchases);
    a.v3 += num(x.video_3sec_views);
    a.thru += num(x.video_thruplays);
    if (x.date < a.first_seen) a.first_seen = x.date;
    if (x.date >= a.last_active) {
      a.last_active = x.date;
      if (x.ad_name) a.ad_name = x.ad_name;
      if (x.effective_status) a.effective_status = x.effective_status;
      if (x.headline) a.headline = x.headline;
      if (x.message) a.message = x.message;
      if (x.video_id) a.is_video = true;
    }
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}

function derived(a: AdAgg, includeText: boolean) {
  return {
    ad_id: a.ad_id,
    ad_name: a.ad_name,
    adset_name: a.adset_name,
    campaign_name: a.campaign_name,
    status: a.effective_status,
    format: a.is_video ? "video" : "static",
    first_seen: a.first_seen,
    spend: r(a.spend),
    impressions: a.impressions,
    clicks: a.clicks,
    installs: a.installs,
    trial_starts: a.trial_starts,
    purchases: a.purchases,
    cpi: div(a.spend, a.installs),
    cost_per_trial: div(a.spend, a.trial_starts),
    ctr_pct: div(a.clicks * 100, a.impressions),
    cpm: div(a.spend * 1000, a.impressions),
    hook_rate_pct: div(a.v3 * 100, a.impressions),
    hold_rate_pct: div(a.thru * 100, a.impressions),
    ...(includeText
      ? {
          headline: a.headline.slice(0, 120),
          primary_text: a.message.slice(0, 240),
        }
      : {}),
  };
}

// --- weekly stats (shared by tool + recap) ----------------------------------

export interface WeeklyStats {
  window: { since: string; until: string };
  prev_window: { since: string; until: string };
  totals: {
    spend: number;
    prev_spend: number;
    spend_delta_pct: number | null;
    meta_trials: number;
    prev_meta_trials: number;
    cost_per_trial: number | null;
    prev_cost_per_trial: number | null;
    installs: number;
    rc_trials: number;
    prev_rc_trials: number;
    blended_cac_per_trial: number | null;
    rc_revenue: number;
    rc_new_customers: number;
    rc_trial_conversions: number;
    creatives_launched: number;
    active_ads: number;
  };
  shifts: {
    scaling: Array<{ ad_id: string; ad_name: string; spend: number; spend_delta_pct: number | null; cost_per_trial: number | null }>;
    declining: Array<{ ad_id: string; ad_name: string; spend: number; spend_delta_pct: number | null; cost_per_trial: number | null }>;
    newly_launched: Array<{ ad_id: string; ad_name: string; spend: number; cost_per_trial: number | null }>;
    recently_paused: Array<{ ad_id: string; ad_name: string; spend_last_14d: number }>;
  };
  ads_this_week: Array<ReturnType<typeof derived>>;
}

export async function buildWeeklyStats(): Promise<WeeklyStats> {
  const until = ymd(new Date());
  const since = daysAgo(6);
  const prevSince = daysAgo(13);
  const prevUntil = daysAgo(7);
  // Read 8 weeks so "newly launched" reflects an ad's TRUE first appearance,
  // not just its first day inside the comparison window.
  const [adRows, rcRows] = await Promise.all([readAds(daysAgo(55), until), readRc(prevSince, until)]);

  const firstSeenAll = new Map<string, string>();
  for (const x of adRows) {
    const c = firstSeenAll.get(x.ad_id);
    if (!c || x.date < c) firstSeenAll.set(x.ad_id, x.date);
  }

  const thisWeek = adRows.filter((x) => x.date >= since);
  const lastWeek = adRows.filter((x) => x.date >= prevSince && x.date < since);
  const cur = aggregateAds(thisWeek);
  const prev = aggregateAds(lastWeek);
  const prevById = new Map(prev.map((a) => [a.ad_id, a]));

  const sum = (rows: AdAgg[], k: "spend" | "installs" | "trial_starts") =>
    rows.reduce((s, x) => s + x[k], 0);
  const spend = sum(cur, "spend");
  const prevSpend = sum(prev, "spend");
  const metaTrials = sum(cur, "trial_starts");
  const prevMetaTrials = sum(prev, "trial_starts");

  const rcCur = rcRows.filter((x) => x.date >= since);
  const rcPrev = rcRows.filter((x) => x.date < since);
  const rcTrials = rcCur.reduce((s, x) => s + num(x.trial_starts), 0);
  const prevRcTrials = rcPrev.reduce((s, x) => s + num(x.trial_starts), 0);
  const rcRevenue = rcCur.reduce((s, x) => s + num(x.revenue), 0);
  const rcNewCustomers = rcCur.reduce((s, x) => s + num(x.new_customers), 0);
  const rcConversions = rcCur.reduce((s, x) => s + num(x.trial_conversions), 0);

  const shiftBase = (a: AdAgg) => ({
    ad_id: a.ad_id,
    ad_name: a.ad_name,
    spend: r(a.spend),
    cost_per_trial: div(a.spend, a.trial_starts),
  });
  const scaling: WeeklyStats["shifts"]["scaling"] = [];
  const declining: WeeklyStats["shifts"]["declining"] = [];
  const newly: WeeklyStats["shifts"]["newly_launched"] = [];
  for (const a of cur) {
    const p = prevById.get(a.ad_id);
    if (!p) {
      if ((firstSeenAll.get(a.ad_id) ?? a.first_seen) >= since) newly.push(shiftBase(a));
      continue;
    }
    const deltaPct = p.spend > 0 ? r(((a.spend - p.spend) / p.spend) * 100, 0) : null;
    if (deltaPct != null && deltaPct >= 25 && a.spend >= 25) {
      scaling.push({ ...shiftBase(a), spend_delta_pct: deltaPct });
    } else if (deltaPct != null && deltaPct <= -25 && p.spend >= 25) {
      declining.push({ ...shiftBase(a), spend_delta_pct: deltaPct });
    }
  }
  const all14 = aggregateAds(adRows.filter((x) => x.date >= prevSince));
  const paused = all14
    .filter((a) => a.effective_status !== "ACTIVE" && a.spend > 0)
    .map((a) => ({ ad_id: a.ad_id, ad_name: a.ad_name, spend_last_14d: r(a.spend) }));

  return {
    window: { since, until },
    prev_window: { since: prevSince, until: prevUntil },
    totals: {
      spend: r(spend),
      prev_spend: r(prevSpend),
      spend_delta_pct: prevSpend > 0 ? r(((spend - prevSpend) / prevSpend) * 100, 0) : null,
      meta_trials: metaTrials,
      prev_meta_trials: prevMetaTrials,
      cost_per_trial: div(spend, metaTrials),
      prev_cost_per_trial: div(prevSpend, prevMetaTrials),
      installs: sum(cur, "installs"),
      rc_trials: rcTrials,
      prev_rc_trials: prevRcTrials,
      blended_cac_per_trial: div(spend, rcTrials),
      rc_revenue: r(rcRevenue),
      rc_new_customers: rcNewCustomers,
      rc_trial_conversions: rcConversions,
      creatives_launched: newly.length,
      active_ads: cur.filter((a) => a.effective_status === "ACTIVE").length,
    },
    shifts: {
      scaling: scaling.slice(0, 8),
      declining: declining.slice(0, 8),
      newly_launched: newly.slice(0, 8),
      recently_paused: paused.slice(0, 12),
    },
    ads_this_week: cur
      .slice(0, 40)
      .map((a) => derived({ ...a, first_seen: firstSeenAll.get(a.ad_id) ?? a.first_seen }, true)),
  };
}

// --- tool registry ----------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

function clampDays(v: unknown, def: number, max = 56): number {
  const n = Math.floor(num(v));
  return n >= 1 && n <= max ? n : def;
}

export const GROWTH_TOOLS: ToolDef[] = [
  {
    name: "ad_performance",
    description:
      "Per-ad (or per-campaign/adset) Meta performance over the last N days from the daily-synced cache: spend, impressions, clicks, installs, trial_starts, purchases + derived CPI, cost_per_trial, CTR, CPM, hook_rate, hold_rate, format, status, first_seen. Sorted by spend, top 50. Set include_text:true to also get each ad's headline + primary text (for angle/messaging analysis).",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window in days (1-56). Default 7." },
        level: { type: "string", enum: ["ad", "adset", "campaign"], description: "Aggregation level. Default ad." },
        include_text: { type: "boolean", description: "Include ad headline + primary text. Default false." },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "all"], description: "Filter by effective status. Default all." },
      },
    },
    run: async (input) => {
      const days = clampDays(input.days, 7);
      // Read the full 8-week history so first_seen is the ad's true launch
      // date, then slice metrics down to the requested window.
      const allRows = await readAds(daysAgo(55), ymd(new Date()));
      const firstSeenAll = new Map<string, string>();
      for (const x of allRows) {
        const c = firstSeenAll.get(x.ad_id);
        if (!c || x.date < c) firstSeenAll.set(x.ad_id, x.date);
      }
      const rows = allRows.filter((x) => x.date >= daysAgo(days - 1));
      const level = input.level === "campaign" || input.level === "adset" ? input.level : "ad";
      let aggs = aggregateAds(rows).map((a) => ({
        ...a,
        first_seen: firstSeenAll.get(a.ad_id) ?? a.first_seen,
      }));
      if (level !== "ad") {
        // Re-key by campaign/adset name: fold the per-ad aggs upward.
        const key = level === "campaign" ? "campaign_name" : "adset_name";
        const m = new Map<string, AdAgg>();
        for (const a of aggs) {
          const k = a[key] || "(unknown)";
          const g = m.get(k);
          if (!g) {
            m.set(k, { ...a, ad_id: k, ad_name: k });
          } else {
            g.spend += a.spend;
            g.impressions += a.impressions;
            g.clicks += a.clicks;
            g.installs += a.installs;
            g.trial_starts += a.trial_starts;
            g.purchases += a.purchases;
            g.v3 += a.v3;
            g.thru += a.thru;
            if (a.first_seen < g.first_seen) g.first_seen = a.first_seen;
          }
        }
        aggs = [...m.values()].sort((a, b) => b.spend - a.spend);
      }
      if (input.status === "ACTIVE" || input.status === "PAUSED") {
        aggs = aggs.filter((a) => a.effective_status === input.status);
      }
      return {
        window: { since: daysAgo(days - 1), until: ymd(new Date()) },
        level,
        rows: aggs.slice(0, 50).map((a) => derived(a, input.include_text === true)),
      };
    },
  },
  {
    name: "week_over_week",
    description:
      "Account-level weekly glance: this week (last 7 days) vs the prior 7 days — spend, Meta-reported trials + cost per trial, RevenueCat trials (all-source truth), blended CAC/trial, revenue, creatives launched, plus performance shifts (scaling / declining / newly launched / recently paused ads). Start here for any 'how are we doing' question.",
    input_schema: { type: "object", properties: {} },
    run: async () => buildWeeklyStats(),
  },
  {
    name: "daily_series",
    description:
      "Daily time series over the last N days joining Meta (spend, installs, trial_starts) with RevenueCat account truth (trial_starts, revenue, new_customers, active_subscriptions, MRR). Use for trends, spikes, and spend-vs-results divergence.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "1-56, default 28" } },
    },
    run: async (input) => {
      const days = clampDays(input.days, 28);
      const since = daysAgo(days - 1);
      const until = ymd(new Date());
      const [adRows, rcRows] = await Promise.all([readAds(since, until), readRc(since, until)]);
      const byDate = new Map<string, { date: string; meta_spend: number; meta_installs: number; meta_trials: number }>();
      for (const x of adRows) {
        const d = byDate.get(x.date) ?? { date: x.date, meta_spend: 0, meta_installs: 0, meta_trials: 0 };
        d.meta_spend += num(x.spend);
        d.meta_installs += num(x.installs);
        d.meta_trials += num(x.trial_starts);
        byDate.set(x.date, d);
      }
      const rcByDate = new Map(rcRows.map((x) => [x.date, x]));
      const dates = [...new Set([...byDate.keys(), ...rcByDate.keys()])].sort();
      return {
        days: dates.map((date) => {
          const m = byDate.get(date);
          const rc = rcByDate.get(date);
          return {
            date,
            meta_spend: r(m?.meta_spend ?? 0),
            meta_installs: m?.meta_installs ?? 0,
            meta_trials: m?.meta_trials ?? 0,
            rc_trials: rc ? num(rc.trial_starts) : null,
            rc_revenue: rc ? r(num(rc.revenue)) : null,
            rc_new_customers: rc ? num(rc.new_customers) : null,
            active_subscriptions: rc ? num(rc.active_subscriptions) : null,
            mrr: rc ? r(num(rc.mrr)) : null,
          };
        }),
      };
    },
  },
  {
    name: "creative_attention",
    description:
      "Per-ad attention funnel over the last N days: hook_rate (3-sec views ÷ impressions), hold_rate (thruplays ÷ impressions), CTR, spend, cost_per_trial. Sorted by hook rate. Use to diagnose WHERE a creative loses people (hook vs hold vs click).",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "1-56, default 14" },
        min_impressions: { type: "number", description: "Default 500" },
      },
    },
    run: async (input) => {
      const days = clampDays(input.days, 14);
      const minImp = Math.max(0, Math.floor(num(input.min_impressions))) || 500;
      const rows = await readAds(daysAgo(days - 1), ymd(new Date()));
      const out = aggregateAds(rows)
        .filter((a) => a.impressions >= minImp)
        .map((a) => ({
          ad_id: a.ad_id,
          ad_name: a.ad_name,
          format: a.is_video ? "video" : "static",
          status: a.effective_status,
          impressions: a.impressions,
          spend: r(a.spend),
          hook_rate_pct: div(a.v3 * 100, a.impressions),
          hold_rate_pct: div(a.thru * 100, a.impressions),
          ctr_pct: div(a.clicks * 100, a.impressions),
          cost_per_trial: div(a.spend, a.trial_starts),
        }))
        .sort((a, b) => (b.hook_rate_pct ?? 0) - (a.hook_rate_pct ?? 0));
      return { window: { since: daysAgo(days - 1), until: ymd(new Date()) }, min_impressions: minImp, rows: out.slice(0, 50) };
    },
  },
  {
    name: "rc_snapshot",
    description:
      "RevenueCat account truth over the last 30 days: revenue, trial starts, trial conversions, trial→paid rate, new customers, current active trials/subscriptions/MRR (latest synced day), mean 30d LTV per paying customer. Account-wide (paid + organic).",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const rows = await readRc(daysAgo(29), ymd(new Date()));
      const latest = rows[0];
      const trials = rows.reduce((s, x) => s + num(x.trial_starts), 0);
      const conversions = rows.reduce((s, x) => s + num(x.trial_conversions), 0);
      const ltvSamples = rows.map((x) => num(x.ltv_30d_per_paying_customer)).filter((n) => n > 0);
      return {
        window: { since: daysAgo(29), until: ymd(new Date()) },
        revenue_30d: r(rows.reduce((s, x) => s + num(x.revenue), 0)),
        trial_starts_30d: trials,
        trial_conversions_30d: conversions,
        trial_to_paid_pct: div(conversions * 100, trials),
        new_customers_30d: rows.reduce((s, x) => s + num(x.new_customers), 0),
        ltv_30d_per_payer_mean: ltvSamples.length ? r(ltvSamples.reduce((s, n) => s + n, 0) / ltvSamples.length) : null,
        latest_day: latest
          ? {
              date: latest.date,
              active_trials: num(latest.active_trials),
              active_subscriptions: num(latest.active_subscriptions),
              mrr: r(num(latest.mrr)),
            }
          : null,
      };
    },
  },
  {
    name: "blended_efficiency",
    description:
      "The truth layer: daily Meta spend joined to RevenueCat revenue/MRR with 7-day rolling MER (revenue ÷ spend), net-new subs, and MRR growth, from the blended_marketing_efficiency view. Newest first. Use when asked about overall paid efficiency / 'is spend paying off'.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "1-90, default 30" } },
    },
    run: async (input) => {
      const days = clampDays(input.days, 30, 90);
      const rows = await sbSelect<Record<string, unknown>>(
        `blended_marketing_efficiency?select=*&order=date.desc&limit=${days}`,
      );
      return {
        days,
        rows: rows.map((x) => ({
          date: String(x.date ?? ""),
          meta_spend_7d: r(num(x.meta_spend_7d)),
          revenue_7d: r(num(x.revenue_7d)),
          mer_7d: r(num(x.mer_7d)),
          net_new_subs_7d: num(x.net_new_subs_7d),
          mrr_growth_7d: r(num(x.mrr_growth_7d)),
        })),
      };
    },
  },
  {
    name: "alerts_digest",
    description:
      "Unresolved anomaly alerts from the daily z-score monitor (marketing_alerts): spend/CPT/CTR spikes and drops at account or campaign scope, with severity. Use for 'anything weird?' / 'what should I look at?' questions.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "1-30, default 7" } },
    },
    run: async (input) => {
      const days = clampDays(input.days, 7, 30);
      const rows = await sbSelect<Record<string, unknown>>(
        `marketing_alerts?select=*&alert_date=gte.${daysAgo(days - 1)}&resolved_at=is.null&order=alert_date.desc&limit=50`,
      );
      const bySeverity: Record<string, number> = {};
      for (const x of rows) {
        const s = String(x.severity ?? "info");
        bySeverity[s] = (bySeverity[s] ?? 0) + 1;
      }
      return {
        window_days: days,
        count: rows.length,
        by_severity: bySeverity,
        alerts: rows.map((x) => ({
          date: String(x.alert_date ?? ""),
          scope: String(x.scope ?? ""),
          campaign_name: x.campaign_name ?? null,
          metric: String(x.metric ?? ""),
          direction: String(x.direction ?? ""),
          severity: String(x.severity ?? ""),
          value: num(x.value),
          baseline: num(x.baseline),
          z: r(num(x.z), 1),
          message: String(x.message ?? ""),
        })),
      };
    },
  },
  {
    name: "payback_ltv",
    description:
      "Unit economics: the payback_summary view (30d LTV per payer ÷ blended CAC per sub over 35d → LTV:CAC ratio + payback verdict) plus per-campaign predicted LTV per trial from campaign_ltv_cohorts (signal ladder: rc_actual > skan_proxy > account_blended). Use for 'is paid worth it long-term' / 'which campaigns produce valuable users'.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const [payback, cohorts] = await Promise.all([
        sbSelect<Record<string, unknown>>(`payback_summary?select=*&limit=1`),
        sbSelect<Record<string, unknown>>(
          `campaign_ltv_cohorts?select=*&order=spend.desc&limit=15`,
        ),
      ]);
      return {
        payback: payback[0] ?? null,
        note: "Per-campaign trial counts are attributed subsets; the `source` column shows signal quality (rc_actual best, account_blended = shared account-level rate).",
        campaigns: cohorts,
      };
    },
  },
  {
    name: "retention_cohorts",
    description:
      "Weekly payer retention cohorts (payer_retention_cohorts view): payers by first-active week, how many are still active vs lapsed, retention rate, average tenure days. Use for retention / churn / cohort-quality questions.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const rows = await sbSelect<Record<string, unknown>>(
        `payer_retention_cohorts?select=*&order=cohort_week.desc&limit=12`,
      );
      return { cohorts: rows };
    },
  },
  {
    name: "skan_health",
    description:
      "SKAN postback pipeline health (skan_health view: signature validity, redownload rate, click- vs view-through) plus reconciliation vs RevenueCat truth (skan_reconciliation: SKAN trials vs RC trials vs blended CAC). Use when asked about attribution coverage or whether SKAN data can be trusted.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const [health, recon] = await Promise.all([
        sbSelect<Record<string, unknown>>(`skan_health?select=*&limit=1`),
        sbSelect<Record<string, unknown>>(`skan_reconciliation?select=*&limit=1`),
      ]);
      return { health: health[0] ?? null, reconciliation: recon[0] ?? null };
    },
  },
  {
    name: "creative_tags",
    description:
      "AI creative-tag rollups (ad_creative_tags joined to the last 56d of performance): group by messaging_theme, visual_format, or audience to see spend, trials, cost/trial, hook rate, and hit rate per group — or group_by 'none' for per-ad tags. THE tool for 'what themes/formats/angles are working'.",
    input_schema: {
      type: "object",
      properties: {
        group_by: {
          type: "string",
          enum: ["messaging_theme", "visual_format", "audience", "none"],
          description: "Default messaging_theme.",
        },
        days: { type: "number", description: "Performance window 1-56, default 56." },
      },
    },
    run: async (input) => {
      const days = clampDays(input.days, 56);
      const groupBy =
        input.group_by === "visual_format" || input.group_by === "audience" || input.group_by === "none"
          ? input.group_by
          : "messaging_theme";
      const [tagRows, adRows] = await Promise.all([
        sbSelect<Record<string, unknown>>(`ad_creative_tags?select=*&limit=5000`),
        readAds(daysAgo(days - 1), ymd(new Date())),
      ]);
      const aggs = aggregateAds(adRows);
      const tagByAd = new Map(tagRows.map((t) => [String(t.ad_id), t]));

      if (groupBy === "none") {
        return {
          window_days: days,
          ads: aggs
            .filter((a) => tagByAd.has(a.ad_id))
            .slice(0, 60)
            .map((a) => {
              const t = tagByAd.get(a.ad_id)!;
              return {
                ad_id: a.ad_id,
                ad_name: a.ad_name,
                visual_format: t.visual_format,
                messaging_theme: t.messaging_theme,
                audience: t.audience,
                hook_type: t.hook_type,
                spend: r(a.spend),
                trial_starts: a.trial_starts,
                cost_per_trial: div(a.spend, a.trial_starts),
              };
            }),
        };
      }

      // account median CPT among ads with trials (hit-rate baseline)
      const cpts = aggs
        .filter((a) => a.trial_starts >= 1 && a.spend > 0)
        .map((a) => a.spend / a.trial_starts)
        .sort((a, b) => a - b);
      const median =
        cpts.length === 0
          ? null
          : cpts.length % 2
            ? cpts[Math.floor(cpts.length / 2)]
            : (cpts[cpts.length / 2 - 1] + cpts[cpts.length / 2]) / 2;

      interface Group {
        key: string;
        description?: string;
        ads: number;
        active: number;
        spend: number;
        impressions: number;
        clicks: number;
        v3: number;
        trials: number;
        qualified: number;
        hits: number;
      }
      const groups = new Map<string, Group>();
      for (const a of aggs) {
        const t = tagByAd.get(a.ad_id);
        if (!t) continue;
        const key = String(t[groupBy] ?? "(untagged)");
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            description: groupBy === "messaging_theme" ? String(t.theme_description ?? "") : undefined,
            ads: 0,
            active: 0,
            spend: 0,
            impressions: 0,
            clicks: 0,
            v3: 0,
            trials: 0,
            qualified: 0,
            hits: 0,
          };
          groups.set(key, g);
        }
        g.ads++;
        if (a.effective_status === "ACTIVE") g.active++;
        g.spend += a.spend;
        g.impressions += a.impressions;
        g.clicks += a.clicks;
        g.v3 += a.v3;
        g.trials += a.trial_starts;
        if (a.spend >= 30) {
          g.qualified++;
          const cpt = a.trial_starts >= 1 ? a.spend / a.trial_starts : null;
          if (cpt != null && (median == null || cpt <= median * 1.2)) g.hits++;
        }
      }
      return {
        window_days: days,
        group_by: groupBy,
        account_median_cpt: median != null ? r(median) : null,
        groups: [...groups.values()]
          .sort((a, b) => b.spend - a.spend)
          .map((g) => ({
            [groupBy]: g.key,
            ...(g.description ? { description: g.description } : {}),
            ads: g.ads,
            active: g.active,
            spend: r(g.spend),
            trials: g.trials,
            cost_per_trial: div(g.spend, g.trials),
            hook_rate_pct: div(g.v3 * 100, g.impressions),
            ctr_pct: div(g.clicks * 100, g.impressions),
            hit_rate_pct: g.qualified > 0 ? r((g.hits / g.qualified) * 100, 0) : null,
            qualified_ads: g.qualified,
          })),
      };
    },
  },
  {
    name: "fatigue_check",
    description:
      "Detect fatiguing ads: ACTIVE ads with ≥$50 spend/14d where trailing-7d CTR or hook rate fell ≥25% vs the prior week while spend held (≥0.8×, min 1k impressions/week), OR cost/trial rose two consecutive weeks. Use for 'which ads are getting tired' / refresh planning.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      // Mirrors the client detector in src/components/growth/data.ts — keep
      // thresholds in sync.
      const rows = await readAds(daysAgo(20), ymd(new Date()));
      const cur = aggregateAds(rows.filter((x) => x.date >= daysAgo(6)));
      const prev = aggregateAds(rows.filter((x) => x.date >= daysAgo(13) && x.date < daysAgo(6)));
      const w2 = aggregateAds(rows.filter((x) => x.date >= daysAgo(20) && x.date < daysAgo(13)));
      const last14 = aggregateAds(rows.filter((x) => x.date >= daysAgo(13)));
      const prevById = new Map(prev.map((a) => [a.ad_id, a]));
      const w2ById = new Map(w2.map((a) => [a.ad_id, a]));
      const last14ById = new Map(last14.map((a) => [a.ad_id, a]));

      const out: Array<Record<string, unknown>> = [];
      for (const a of cur) {
        const base = last14ById.get(a.ad_id);
        if (!base || base.effective_status !== "ACTIVE" || base.spend < 50) continue;
        const p = prevById.get(a.ad_id);
        if (p && a.impressions >= 1000 && p.impressions >= 1000 && a.spend >= p.spend * 0.8) {
          const ctrCur = a.clicks / a.impressions;
          const ctrPrev = p.clicks / p.impressions;
          const hookCur = a.v3 / a.impressions;
          const hookPrev = p.v3 / p.impressions;
          if ((ctrPrev > 0 && ctrCur <= ctrPrev * 0.75) || (hookPrev > 0 && hookCur <= hookPrev * 0.75)) {
            out.push({
              ad_id: a.ad_id,
              ad_name: a.ad_name,
              signal: "attention_decay",
              spend_7d: r(a.spend),
              spend_prev_7d: r(p.spend),
              ctr_pct: div(a.clicks * 100, a.impressions),
              ctr_prev_pct: div(p.clicks * 100, p.impressions),
              hook_rate_pct: div(a.v3 * 100, a.impressions),
              hook_prev_pct: div(p.v3 * 100, p.impressions),
            });
            continue;
          }
        }
        const p2 = w2ById.get(a.ad_id);
        if (p && p2 && a.trial_starts >= 1 && p.trial_starts >= 1 && p2.trial_starts >= 1) {
          const c0 = a.spend / a.trial_starts;
          const c1 = p.spend / p.trial_starts;
          const c2 = p2.spend / p2.trial_starts;
          if (c0 > c1 && c1 > c2) {
            out.push({
              ad_id: a.ad_id,
              ad_name: a.ad_name,
              signal: "cpt_rising",
              cpt_by_week: [r(c2), r(c1), r(c0)],
              spend_7d: r(a.spend),
            });
          }
        }
      }
      return { fatiguing: out, checked_active_ads: [...last14ById.values()].filter((a) => a.effective_status === "ACTIVE" && a.spend >= 50).length };
    },
  },
  {
    name: "propose_action",
    description:
      "Propose a Meta Ads change for the user to confirm — pause/activate an ad, set an ad set or campaign daily budget, or duplicate an ad set. This NEVER executes anything: it renders a confirmation card in the dashboard that the user must explicitly approve. Only propose after the data justifies it, cite the numbers in `reason`, and propose at most one action per distinct change. Never claim a change was made.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["pause_ad", "activate_ad", "set_adset_budget", "set_campaign_budget", "duplicate_adset"],
        },
        target_id: { type: "string", description: "The Meta id of the ad / ad set / campaign." },
        target_name: { type: "string", description: "Human name of the target." },
        params: {
          type: "object",
          properties: {
            daily_budget_cents: { type: "number", description: "For set_*_budget: new daily budget in cents (e.g. 5000 = $50)." },
            target_campaign_id: { type: "string", description: "For duplicate_adset: optional destination campaign." },
          },
        },
        reason: { type: "string", description: "One sentence citing the evidence, e.g. '$521 spend, 0 trials, hook 46% but CTR 1.2% — creative isn't converting.'" },
      },
      required: ["kind", "target_id", "target_name", "reason"],
    },
    run: async (input) => {
      const kind = String(input.kind ?? "");
      const validKinds = ["pause_ad", "activate_ad", "set_adset_budget", "set_campaign_budget", "duplicate_adset"];
      if (!validKinds.includes(kind)) throw new Error(`invalid kind: ${kind}`);
      const targetId = String(input.target_id ?? "").trim();
      if (!targetId) throw new Error("target_id required");
      const params = (input.params ?? {}) as Record<string, unknown>;
      if ((kind === "set_adset_budget" || kind === "set_campaign_budget") && !(num(params.daily_budget_cents) >= 100)) {
        throw new Error("set_*_budget needs params.daily_budget_cents ≥ 100");
      }
      return {
        proposed: true,
        note: "Rendered as a confirmation card — the user must approve before anything is applied. Do not claim the change happened.",
        kind,
        target_id: targetId,
        target_name: String(input.target_name ?? ""),
        params: {
          ...(params.daily_budget_cents != null ? { daily_budget_cents: Math.floor(num(params.daily_budget_cents)) } : {}),
          ...(params.target_campaign_id ? { target_campaign_id: String(params.target_campaign_id) } : {}),
        },
        reason: String(input.reason ?? ""),
      };
    },
  },
];

// --- the agent loop ---------------------------------------------------------

export const GROWTH_SYSTEM_PROMPT = `You are the DreamMe Growth AI — the marketing brain embedded in DreamMe's internal admin dashboard. You do what tools like Motion's Runneth do, but purpose-built for a consumer subscription app running paid social.

## The business
- DreamMe is a consumer iOS app: a GLP-1 companion + self-care Tamagotchi (medication/shot logging, protein & fiber tracking, weight journey, virtual pet). Monetization: free trial → auto-renewing subscription via RevenueCat.
- Paid acquisition runs on Meta (app-install campaigns, SKAN-measured). Creatives are persona-led UGC-style videos (creator names like Kylie, Maggie, Kendall, Bethany, Cara appear in ad names) plus experimental statics (e.g. the "Comic sans scribble" ad).
- Funnel: install → trial start → day-7 trial→paid conversion. Cancels peak on day 2; conversions land around day 7. LTV is roughly $34 per paying customer and cash is front-loaded.

## Measurement rules you must respect (iOS reality)
- Meta-reported trial_starts / installs under-count (ATT + SKAN). They are RANKING signals for comparing ads, not absolute truth.
- RevenueCat is the truth layer for absolute counts (trials, revenue, MRR). Blended CAC = spend ÷ RC trials, and 7d MER = RC revenue ÷ spend, are the honest account-level efficiency numbers.
- Account-wide revenue includes a large organic base (TikTok organic dominates installs), so account ROAS overstates paid performance. Never quote account ROAS as if ads drove all of it.
- Cost per trial started (Meta-reported) is the primary creative-level KPI; hook_rate (3s views ÷ impressions) and hold_rate (thruplays ÷ impressions) diagnose attention.

## How to answer
- ALWAYS pull data with tools before answering anything quantitative. Start with week_over_week for "how are we doing" questions; use ad_performance / creative_attention for creative questions; blended_efficiency + rc_snapshot for efficiency/LTV questions.
- Tool routing: "what themes/formats/angles work" → creative_tags · "anything weird / what should I look at" → alerts_digest · "worth it long-term / which campaigns produce valuable users" → payback_ltv, retention_cohorts · "can we trust attribution" → skan_health · "which ads are tired / need refresh" → fatigue_check.

## Actions (propose_action)
- You can PROPOSE Meta changes — pause/activate an ad, set an ad set/campaign daily budget, duplicate an ad set — via the propose_action tool. It never executes; the user sees a confirmation card and must approve.
- Only propose when the evidence clearly justifies it, cite the numbers in the reason field, and propose at most one action per distinct change (no duplicates across turns unless asked again).
- After proposing, tell the user the action is awaiting their confirmation. NEVER state or imply a change was applied — you will see "[user confirmed: ...]" or "[user dismissed: ...]" in the transcript if they acted on it.
- Lead with the answer in one or two sentences, then evidence, then actions.
- Recommendations follow the pattern: WHY (evidence from the data — name ads, cite $ and %), then WHAT NEXT (a specific action: cut / scale / iterate, with concrete budget or creative direction).
- Be direct and specific. "$905 spend at $12.93/trial — scale it" beats hedging. If sample sizes are small (a few trials), say so and be appropriately humble.
- Use markdown: short paragraphs, bold key numbers, small tables where they genuinely help. No filler.
- If data is missing or a tool errors, say exactly what's missing rather than inventing numbers.`;

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export type ActionKind =
  | "pause_ad"
  | "activate_ad"
  | "set_adset_budget"
  | "set_campaign_budget"
  | "duplicate_adset";

export interface ProposedAction {
  kind: ActionKind;
  target_id: string;
  target_name: string;
  params: { daily_budget_cents?: number; target_campaign_id?: string };
  reason: string;
}

export interface AgentResult {
  reply: string;
  steps: AgentStep[];
  proposals: ProposedAction[];
  usage: { input_tokens: number; output_tokens: number };
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 529]);

async function anthropicCall(body: Record<string, unknown>, maxRetries = 3): Promise<{
  content: ContentBlock[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  let attempt = 0;
  while (true) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      return (await res.json()) as {
        content: ContentBlock[];
        stop_reason: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
    }
    const text = await res.text();
    if (!RETRYABLE.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Anthropic error: ${res.status} ${text.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * Math.pow(2, attempt))));
    attempt++;
  }
}

/** One-line human summary of a tool result for the UI's activity trace. */
function summarizeToolResult(name: string, result: unknown): string {
  try {
    const o = result as Record<string, unknown>;
    const rows = Array.isArray(o?.rows) ? o.rows.length : Array.isArray(o?.days) ? (o.days as unknown[]).length : null;
    if (name === "week_over_week") {
      const t = (o as { totals?: { spend?: number; cost_per_trial?: number | null } }).totals;
      return `spend $${t?.spend ?? "?"} · CPT ${t?.cost_per_trial != null ? `$${t.cost_per_trial}` : "—"}`;
    }
    if (rows != null) return `${rows} rows`;
    return "ok";
  } catch {
    return "ok";
  }
}

export async function runGrowthAgent(params: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model: string;
  maxTurns?: number;
}): Promise<AgentResult> {
  const tools = GROWTH_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const toolByName = new Map(GROWTH_TOOLS.map((t) => [t.name, t]));

  // Seed conversation from the client transcript (plain text turns).
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = params.messages.map(
    (m) => ({ role: m.role, content: m.content }),
  );

  const steps: AgentStep[] = [];
  const proposals: ProposedAction[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const maxTurns = params.maxTurns ?? 8;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await anthropicCall({
      model: params.model,
      max_tokens: 4000,
      system: [{ type: "text", text: GROWTH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
    usage.input_tokens += res.usage?.input_tokens ?? 0;
    usage.output_tokens += res.usage?.output_tokens ?? 0;

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      return { reply, steps, proposals, usage };
    }

    messages.push({ role: "assistant", content: res.content });
    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      const tool = toolByName.get(tu.name ?? "");
      const input = (tu.input ?? {}) as Record<string, unknown>;
      try {
        if (!tool) throw new Error(`unknown tool ${tu.name}`);
        const out = await tool.run(input);
        steps.push({ tool: tu.name ?? "", input, ok: true, summary: summarizeToolResult(tu.name ?? "", out) });
        if (tu.name === "propose_action") {
          const o = out as ProposedAction & { proposed: boolean };
          proposals.push({
            kind: o.kind,
            target_id: o.target_id,
            target_name: o.target_name,
            params: o.params ?? {},
            reason: o.reason,
          });
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id ?? "",
          content: JSON.stringify(out),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        steps.push({ tool: tu.name ?? "", input, ok: false, summary: msg.slice(0, 120) });
        results.push({
          type: "tool_result",
          tool_use_id: tu.id ?? "",
          content: JSON.stringify({ error: msg }),
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return {
    reply:
      "I hit my tool-call budget before finishing. Here's what I gathered so far — ask me to continue for the rest.",
    steps,
    proposals,
    usage,
  };
}

/**
 * Single forced-tool call that returns validated structured output.
 * `user` accepts plain text or an array of content blocks (e.g. image +
 * text for the creative tagger).
 */
export async function structuredCall<T>(params: {
  model: string;
  system: string;
  user: string | Array<Record<string, unknown>>;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  validate: (v: unknown) => T;
  maxTokens?: number;
}): Promise<{ value: T; usage: { input_tokens: number; output_tokens: number } }> {
  const res = await anthropicCall({
    model: params.model,
    max_tokens: params.maxTokens ?? 4000,
    system: params.system,
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        input_schema: params.schema,
      },
    ],
    tool_choice: { type: "tool", name: params.toolName },
    messages: [{ role: "user", content: params.user }],
  });
  const tu = res.content.find((b) => b.type === "tool_use");
  if (!tu?.input) throw new Error("model did not return structured output");
  return {
    value: params.validate(tu.input),
    usage: {
      input_tokens: res.usage?.input_tokens ?? 0,
      output_tokens: res.usage?.output_tokens ?? 0,
    },
  };
}
