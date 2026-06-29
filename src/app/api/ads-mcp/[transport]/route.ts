/**
 * DreamMe Ads MCP server (remote, Streamable HTTP) — lets an AI agent read
 * Meta Ads performance + RevenueCat metrics and make guarded ad changes,
 * hitting the Meta Graph API directly with our own token (no third-party
 * connector / rate cap). Hosted on the dashboard at /api/ads-mcp/mcp.
 *
 * Auth: every request must carry `Authorization: Bearer <MCP_TOKEN>`. Mirrors
 * the bearer pattern in src/lib/auth-ingest.ts. Fails closed if MCP_TOKEN unset.
 *
 * Reuses the dashboard's existing modules:
 *   - src/lib/vendors/meta-ads.ts   (live insights + write helpers)
 *   - src/lib/vendors/revenuecat.ts (account metrics)
 *   - src/lib/supabase.ts           (cached daily insights + blended view)
 */
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  fetchAdInsightsWithCreative,
  updateEntityStatus,
  updateEntityDailyBudget,
  copyCampaign,
  copyAdSet,
  copyAd,
  type AdInsightRowWithCreative,
} from "@/lib/vendors/meta-ads";
import { getActiveConnection } from "@/lib/meta-oauth";
import {
  fetchOverview,
  fetchChart,
  valuesByDate,
  revenueCatConfigured,
} from "@/lib/vendors/revenuecat";
import { SUPABASE_URL, SUPABASE_ANON, API } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_ACCOUNT = "act_1575502753719515";
const DEFAULT_DATASET = "1777837186267557";

function acct(): string {
  return process.env.META_AD_ACCOUNT_ID || DEFAULT_ACCOUNT;
}

/**
 * Resolve the Meta token + ad account to use: prefer the OAuth-connected
 * account stored via the dashboard (the "Login with Facebook" flow), fall
 * back to the META_ACCESS_TOKEN env var. Returns null if neither exists.
 */
async function resolveMeta(): Promise<{ token: string; account: string } | null> {
  try {
    const conn = await getActiveConnection();
    if (conn?.access_token) {
      return { token: conn.access_token, account: conn.default_ad_account_id || acct() };
    }
  } catch {
    // fall through to env
  }
  const envTok = process.env.META_ACCESS_TOKEN ?? "";
  if (envTok) return { token: envTok, account: acct() };
  return null;
}

const NO_META =
  "No Meta connection — connect an account in the dashboard Integrations panel (or set META_ACCESS_TOKEN).";

// --- small helpers ---------------------------------------------------------
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultRange(since?: string, until?: string): { since: string; until: string } {
  return {
    since: since || ymd(new Date(Date.now() - 7 * 86_400_000)),
    until: until || ymd(new Date()),
  };
}
function r(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
function div(a: number, b: number, decimals = 2): number | null {
  return b > 0 ? r(a / b, decimals) : null;
}
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

type Level = "campaign" | "adset" | "ad";

interface Norm {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: number;
  store_visits: number;
}

function normLive(rows: AdInsightRowWithCreative[]): Norm[] {
  return rows.map((x) => ({
    campaign_id: x.campaign_id,
    campaign_name: x.campaign_name,
    adset_id: x.adset_id,
    adset_name: x.adset_name,
    ad_id: x.ad_id,
    ad_name: x.ad_name,
    spend: x.spend,
    impressions: x.impressions,
    clicks: x.clicks,
    installs: x.installs,
    trial_starts: x.startTrials,
    purchases: x.purchases,
    purchase_value: x.purchase_value,
    store_visits: x.storeVisits,
  }));
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function normCached(rows: Array<Record<string, unknown>>): Norm[] {
  // ad_insights_daily has no app_store_visit column → store_visits = 0.
  return rows.map((x) => ({
    campaign_id: String(x.campaign_id ?? ""),
    campaign_name: String(x.campaign_name ?? ""),
    adset_id: String(x.adset_id ?? ""),
    adset_name: String(x.adset_name ?? ""),
    ad_id: String(x.ad_id ?? ""),
    ad_name: String(x.ad_name ?? ""),
    spend: num(x.spend),
    impressions: num(x.impressions),
    clicks: num(x.clicks),
    installs: num(x.installs),
    trial_starts: num(x.trial_starts),
    purchases: num(x.purchases),
    purchase_value: num(x.purchase_value),
    store_visits: 0,
  }));
}

function summarize(rows: Norm[], level: Level) {
  const groups = new Map<string, Norm & { id: string; name: string }>();
  for (const x of rows) {
    const id = level === "campaign" ? x.campaign_id : level === "adset" ? x.adset_id : x.ad_id;
    if (!id) continue;
    let g = groups.get(id);
    if (!g) {
      g = {
        ...x,
        id,
        name: level === "campaign" ? x.campaign_name : level === "adset" ? x.adset_name : x.ad_name,
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        trial_starts: 0,
        purchases: 0,
        purchase_value: 0,
        store_visits: 0,
      };
      groups.set(id, g);
    }
    g.spend += x.spend;
    g.impressions += x.impressions;
    g.clicks += x.clicks;
    g.installs += x.installs;
    g.trial_starts += x.trial_starts;
    g.purchases += x.purchases;
    g.purchase_value += x.purchase_value;
    g.store_visits += x.store_visits;
  }
  return [...groups.values()]
    .map((g) => ({
      level,
      id: g.id,
      name: g.name,
      campaign_name: g.campaign_name,
      spend: r(g.spend),
      impressions: g.impressions,
      clicks: g.clicks,
      installs: g.installs,
      trial_starts: g.trial_starts,
      purchases: g.purchases,
      purchase_value: r(g.purchase_value),
      store_visits: g.store_visits,
      cpi: div(g.spend, g.installs),
      cost_per_trial: div(g.spend, g.trial_starts),
      cost_per_purchase: div(g.spend, g.purchases),
      cost_per_store_visit: div(g.spend, g.store_visits),
      ctr_pct: div(g.clicks * 100, g.impressions),
      cpm: div(g.spend * 1000, g.impressions),
      roas: div(g.purchase_value, g.spend, 3),
    }))
    .sort((a, b) => b.spend - a.spend);
}

async function readAdInsightsDaily(params: {
  since: string;
  until: string;
  campaignId?: string;
}): Promise<Array<Record<string, unknown>>> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
  }
  const filters = [
    "select=*",
    `date=gte.${params.since}`,
    `date=lte.${params.until}`,
  ];
  if (params.campaignId) filters.push(`campaign_id=eq.${params.campaignId}`);
  filters.push("limit=20000");
  const url = `${SUPABASE_URL}/rest/v1/ad_insights_daily?${filters.join("&")}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ad_insights_daily read failed: ${res.status}`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

// --- tool registration -----------------------------------------------------
const RC_CHARTS = [
  "trials_new",
  "trial_conversion_rate",
  "revenue",
  "ltv_per_paying_customer",
  "mrr",
  "actives",
  "customers_new",
  "churn",
  "subscription_status",
] as const;

const mcpHandler = createMcpHandler(
  (server) => {
    // --- READ: live Meta insights (the Pipeboard bypass) -----------------
    server.tool(
      "meta_ad_insights_live",
      "Live Meta Ads performance for the ad account, straight from the Graph API. Aggregates per campaign/adset/ad over a date range and returns spend, impressions, installs, trial_starts, purchases plus derived CPI, cost_per_trial, cost_per_purchase, cost_per_store_visit (SKAN-neutral), CTR, CPM, ROAS. Defaults to the last 7 days.",
      {
        level: z.enum(["campaign", "adset", "ad"]).default("campaign"),
        since: z.string().optional().describe("YYYY-MM-DD inclusive; defaults to 7 days ago"),
        until: z.string().optional().describe("YYYY-MM-DD inclusive; defaults to today"),
      },
      async ({ level, since, until }) => {
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        const range = defaultRange(since, until);
        try {
          const rows = await fetchAdInsightsWithCreative({
            accountId: meta.account,
            since: range.since,
            until: range.until,
            timeIncrement: "all_days",
            accessToken: meta.token,
          });
          return json({ window: range, level, account: meta.account, rows: summarize(normLive(rows), level) });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: cached daily insights (fast, no Meta token) ---------------
    server.tool(
      "ad_insights_cached",
      "Same metrics as meta_ad_insights_live but from the daily-synced Supabase table ad_insights_daily (fast, works without the Meta token). Note: no cost_per_store_visit (not stored). Defaults to the last 7 days.",
      {
        level: z.enum(["campaign", "adset", "ad"]).default("campaign"),
        since: z.string().optional(),
        until: z.string().optional(),
        campaign_id: z.string().optional().describe("Filter to one campaign id"),
      },
      async ({ level, since, until, campaign_id }) => {
        const range = defaultRange(since, until);
        try {
          const rows = await readAdInsightsDaily({ ...range, campaignId: campaign_id });
          return json({ window: range, level, source: "ad_insights_daily", rows: summarize(normCached(rows), level) });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: creative hook / hold rate ---------------------------------
    server.tool(
      "creative_hook_read",
      "Per-creative attention metrics from ad_insights_daily: hook_rate (3-sec video views ÷ impressions), hold_rate (thruplays ÷ impressions), CTR, spend. Sorted by hook_rate. Defaults to last 14 days, min 1000 impressions.",
      {
        since: z.string().optional(),
        until: z.string().optional(),
        min_impressions: z.number().int().min(0).default(1000),
      },
      async ({ since, until, min_impressions }) => {
        const range = {
          since: since || ymd(new Date(Date.now() - 14 * 86_400_000)),
          until: until || ymd(new Date()),
        };
        try {
          const rows = await readAdInsightsDaily(range);
          const byAd = new Map<string, {
            ad_id: string; ad_name: string; creative_id: string; creative_name: string;
            impressions: number; clicks: number; spend: number; v3: number; thru: number;
          }>();
          for (const x of rows) {
            const id = String(x.ad_id ?? "");
            if (!id) continue;
            let g = byAd.get(id);
            if (!g) {
              g = {
                ad_id: id,
                ad_name: String(x.ad_name ?? ""),
                creative_id: String(x.creative_id ?? ""),
                creative_name: String(x.creative_name ?? ""),
                impressions: 0, clicks: 0, spend: 0, v3: 0, thru: 0,
              };
              byAd.set(id, g);
            }
            g.impressions += num(x.impressions);
            g.clicks += num(x.clicks);
            g.spend += num(x.spend);
            g.v3 += num(x.video_3sec_views);
            g.thru += num(x.video_thruplays);
          }
          const out = [...byAd.values()]
            .filter((g) => g.impressions >= min_impressions)
            .map((g) => ({
              ad_id: g.ad_id,
              ad_name: g.ad_name,
              creative_name: g.creative_name,
              impressions: g.impressions,
              spend: r(g.spend),
              hook_rate_pct: div(g.v3 * 100, g.impressions),
              hold_rate_pct: div(g.thru * 100, g.impressions),
              ctr_pct: div(g.clicks * 100, g.impressions),
            }))
            .sort((a, b) => (b.hook_rate_pct ?? 0) - (a.hook_rate_pct ?? 0));
          return json({ window: range, min_impressions, rows: out });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: blended efficiency (ROAS / MER) ---------------------------
    server.tool(
      "blended_efficiency",
      "Account-wide marketing efficiency from the blended_marketing_efficiency view: daily Meta spend joined to RevenueCat revenue/MRR with 7-day rolling MER, net new subs, MRR growth. Defaults to last 30 days, newest first.",
      { days: z.number().int().min(1).max(365).default(30) },
      async ({ days }) => {
        try {
          const rows = await API.fetchBlendedEfficiency(days);
          return json({ days, rows });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: RevenueCat account overview -------------------------------
    server.tool(
      "rc_overview",
      "Live RevenueCat account snapshot: active_trials, active_subscriptions, mrr, revenue, new_customers, active_users.",
      {},
      async () => {
        if (!revenueCatConfigured()) return fail("REVENUECAT_API_KEY / REVENUECAT_PROJECT_ID not set.");
        try {
          return json(await fetchOverview());
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: RevenueCat chart time series ------------------------------
    server.tool(
      "rc_chart",
      "Live RevenueCat time series for a chart (daily). Returns one value per day for the first measure. Account-level only — per-ad attribution is not available.",
      {
        chart: z.enum(RC_CHARTS),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
      },
      async ({ chart, start_date, end_date }) => {
        if (!revenueCatConfigured()) return fail("REVENUECAT_API_KEY / REVENUECAT_PROJECT_ID not set.");
        try {
          const c = await fetchChart({ chartName: chart, startDate: start_date, endDate: end_date, resolution: "day" });
          const series = [...valuesByDate(c).entries()].map(([date, value]) => ({ date, value }));
          return json({ chart, measure: c.measures?.[0]?.display_name ?? null, series });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: CAPI dataset status (watch the RC→Meta pipe) --------------
    server.tool(
      "capi_dataset_status",
      "Check the Meta dataset's last-fired timestamps — server_last_fired_time shows whether RevenueCat's Conversions API integration is actually delivering server-side events yet.",
      { dataset_id: z.string().optional() },
      async ({ dataset_id }) => {
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        const token = meta.token;
        const ver = process.env.META_API_VERSION ?? "v22.0";
        const id = dataset_id || DEFAULT_DATASET;
        try {
          const url = `https://graph.facebook.com/${ver}/${id}?fields=name,is_active,last_fired_time,server_last_fired_time`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const body = await res.json();
          if (!res.ok) return fail(`Meta dataset read failed: ${res.status} ${JSON.stringify(body)}`);
          return json(body);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- WRITE: status (pause/activate) ----------------------------------
    const statusShape = {
      id: z.string().describe("Ad, ad set, or campaign id"),
      status: z.enum(["ACTIVE", "PAUSED"]),
      confirm: z.boolean().default(false).describe("Must be true to actually apply the change"),
      dry_run: z.boolean().default(false),
    };
    async function doStatus(args: { id: string; status: "ACTIVE" | "PAUSED"; confirm: boolean; dry_run: boolean }) {
      if (args.dry_run) return json({ dry_run: true, would: { id: args.id, status: args.status } });
      if (!args.confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
      const meta = await resolveMeta();
      if (!meta) return fail(NO_META);
      try {
        await updateEntityStatus({ id: args.id, status: args.status, accessToken: meta.token });
        return json({ applied: true, id: args.id, status: args.status });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
    server.tool("set_ad_status", "Pause or activate an ad. Guarded: requires confirm:true.", statusShape, doStatus);
    server.tool("set_adset_status", "Pause or activate an ad set. Guarded: requires confirm:true.", statusShape, doStatus);
    server.tool("set_campaign_status", "Pause or activate a campaign. Guarded: requires confirm:true.", statusShape, doStatus);

    // --- WRITE: daily budget ---------------------------------------------
    const budgetShape = {
      id: z.string().describe("Ad set or campaign id"),
      daily_budget_cents: z.number().int().min(100).describe("Daily budget in cents, e.g. 5000 = $50"),
      confirm: z.boolean().default(false),
      dry_run: z.boolean().default(false),
    };
    async function doBudget(args: { id: string; daily_budget_cents: number; confirm: boolean; dry_run: boolean }) {
      const usd = r(args.daily_budget_cents / 100);
      if (args.dry_run) return json({ dry_run: true, would: { id: args.id, daily_budget_usd: usd } });
      if (!args.confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
      const meta = await resolveMeta();
      if (!meta) return fail(NO_META);
      try {
        await updateEntityDailyBudget({ id: args.id, dailyBudgetCents: args.daily_budget_cents, accessToken: meta.token });
        return json({ applied: true, id: args.id, daily_budget_usd: usd });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
    server.tool("set_adset_budget", "Set an ad set's daily budget. Guarded: requires confirm:true.", budgetShape, doBudget);
    server.tool("set_campaign_budget", "Set a campaign's daily budget (CBO). Guarded: requires confirm:true.", budgetShape, doBudget);

    // --- WRITE: duplication (duplicate-to-graduate) ----------------------
    const COPY_NOTE = "New objects validate async — effective_status may be IN_PROCESS; re-check with the get/insights tools in 1-2 min.";
    const STATUS_OPT = z.enum(["ACTIVE", "PAUSED", "INHERITED_FROM_SOURCE"]).default("PAUSED");

    server.tool(
      "duplicate_campaign",
      "Duplicate a campaign via Meta's /copies edge (deep_copy also clones its ad sets + ads). Defaults to PAUSED + ' - Copy' suffix so the copy never silently spends. Optionally set a new daily budget on the copy. Guarded: requires confirm:true.",
      {
        campaign_id: z.string(),
        deep_copy: z.boolean().default(true),
        status: STATUS_OPT,
        rename_suffix: z.string().default(" - Copy"),
        new_daily_budget_cents: z.number().int().min(100).optional(),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async (a) => {
        if (a.dry_run) return json({ dry_run: true, would: { duplicate_campaign: a.campaign_id, deep_copy: a.deep_copy, status: a.status } });
        if (!a.confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        try {
          const res = await copyCampaign({ campaignId: a.campaign_id, deepCopy: a.deep_copy, statusOption: a.status, renameSuffix: a.rename_suffix, accessToken: meta.token });
          let daily_budget_usd: number | undefined;
          if (a.new_daily_budget_cents && res.copied_id) {
            await updateEntityDailyBudget({ id: res.copied_id, dailyBudgetCents: a.new_daily_budget_cents, accessToken: meta.token });
            daily_budget_usd = r(a.new_daily_budget_cents / 100);
          }
          return json({ applied: true, copied_campaign_id: res.copied_id, status: a.status, daily_budget_usd, note: COPY_NOTE });
        } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
      },
    );

    server.tool(
      "duplicate_adset",
      "Duplicate an ad set via /copies (deep_copy also clones its ads). Optionally copy into another campaign (target_campaign_id) and/or set a new daily budget — the duplicate-to-graduate move. Defaults to PAUSED + ' - Copy'. Guarded: requires confirm:true.",
      {
        adset_id: z.string(),
        target_campaign_id: z.string().optional(),
        deep_copy: z.boolean().default(true),
        status: STATUS_OPT,
        rename_suffix: z.string().default(" - Copy"),
        new_daily_budget_cents: z.number().int().min(100).optional(),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async (a) => {
        if (a.dry_run) return json({ dry_run: true, would: { duplicate_adset: a.adset_id, into_campaign: a.target_campaign_id ?? "(same)", deep_copy: a.deep_copy, status: a.status } });
        if (!a.confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        try {
          const res = await copyAdSet({ adsetId: a.adset_id, targetCampaignId: a.target_campaign_id, deepCopy: a.deep_copy, statusOption: a.status, renameSuffix: a.rename_suffix, accessToken: meta.token });
          let daily_budget_usd: number | undefined;
          if (a.new_daily_budget_cents && res.copied_id) {
            await updateEntityDailyBudget({ id: res.copied_id, dailyBudgetCents: a.new_daily_budget_cents, accessToken: meta.token });
            daily_budget_usd = r(a.new_daily_budget_cents / 100);
          }
          return json({ applied: true, copied_adset_id: res.copied_id, status: a.status, daily_budget_usd, note: COPY_NOTE });
        } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
      },
    );

    server.tool(
      "duplicate_ad",
      "Duplicate an ad via /copies, optionally into another ad set (target_adset_id). Defaults to PAUSED + ' - Copy'. Guarded: requires confirm:true.",
      {
        ad_id: z.string(),
        target_adset_id: z.string().optional(),
        status: STATUS_OPT,
        rename_suffix: z.string().default(" - Copy"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async (a) => {
        if (a.dry_run) return json({ dry_run: true, would: { duplicate_ad: a.ad_id, into_adset: a.target_adset_id ?? "(same)", status: a.status } });
        if (!a.confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        try {
          const res = await copyAd({ adId: a.ad_id, targetAdsetId: a.target_adset_id, statusOption: a.status, renameSuffix: a.rename_suffix, accessToken: meta.token });
          return json({ applied: true, copied_ad_id: res.copied_id, status: a.status, note: COPY_NOTE });
        } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
      },
    );
  },
  { serverInfo: { name: "dreamme-ads", version: "1.0.0" } },
  // SSE is deprecated (and needs Redis); Claude Code uses Streamable HTTP only.
  { basePath: "/api/ads-mcp", maxDuration: 300, disableSse: true, verboseLogs: false },
);

// Bearer-auth gate (fails closed if MCP_TOKEN unset). Wraps every method.
function guard(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const expected = process.env.MCP_TOKEN ?? "";
    const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || got !== expected) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }),
        { status: 401, headers: { "content-type": "application/json", "WWW-Authenticate": "Bearer" } },
      );
    }
    return handler(req);
  };
}

const GET = guard(mcpHandler);
const POST = guard(mcpHandler);
const DELETE = guard(mcpHandler);

export { GET, POST, DELETE };
