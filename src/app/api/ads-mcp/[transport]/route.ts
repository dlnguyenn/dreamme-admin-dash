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
  uploadVideoByUrl,
  waitForVideoReady,
  getVideoThumbnail,
  uploadImageByUrl,
  createVideoCreative,
  createAd,
  createExistingPostCreative,
  getAdObjectStoryId,
  deleteEntity,
  fetchAdCreativeInfo,
  type AdInsightRowWithCreative,
} from "@/lib/vendors/meta-ads";
import { resolveMeta, normAcct, NO_META, defaultAccount } from "@/lib/meta-resolve";
import { getActiveConnection } from "@/lib/meta-oauth";
import { attachSuppression, runAudienceSync } from "@/lib/audiences";
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

const DEFAULT_DATASET = "1777837186267557";

// resolveMeta / normAcct / NO_META live in @/lib/meta-resolve (shared with
// /api/growth/act). `acct` keeps the local name used throughout this file.
const acct = defaultAccount;

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
        account_id: z.string().optional().describe("Target a specific connected ad account (act_… or numeric); defaults to the connection's default. See list_ad_accounts."),
      },
      async ({ level, since, until, account_id }) => {
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        const account = account_id ? normAcct(account_id) : meta.account;
        const range = defaultRange(since, until);
        try {
          const rows = await fetchAdInsightsWithCreative({
            accountId: account,
            since: range.since,
            until: range.until,
            timeIncrement: "all_days",
            accessToken: meta.token,
          });
          return json({ window: range, level, account, rows: summarize(normLive(rows), level) });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: connected ad accounts ------------------------------------
    server.tool(
      "list_ad_accounts",
      "List the ad accounts available on the connected Meta account (captured at OAuth time), with the default. Use an id from here as the account_id arg in meta_ad_insights_live / batch_create_video_ads to target a non-default account.",
      {},
      async () => {
        const conn = await getActiveConnection();
        if (conn) return json({ default_ad_account_id: conn.default_ad_account_id, ad_accounts: conn.ad_accounts ?? [] });
        return json({ default_ad_account_id: acct(), ad_accounts: [], note: "No OAuth connection — falling back to env META_AD_ACCOUNT_ID." });
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
          // NOTE: `is_active` is not a valid field on the dataset/pixel node
          // (Graph returns "(#100) nonexisting field") — request only real ones.
          const url = `https://graph.facebook.com/${ver}/${id}?fields=name,last_fired_time,server_last_fired_time`;
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

    // --- READ: SKAN overview (first-party MMP status) ---------------------
    // One-call answer to "are SKAN trials landing, and what do they cost?".
    // Reads the anon-readable aggregate views (the raw skan_postbacks table is
    // service-role only); rows with campaign_key 'src:NNNN' are postbacks whose
    // source_identifier has no row in skan_campaign_mapping yet.
    server.tool(
      "skan_overview",
      "First-party SKAN MMP status: total postbacks + per-campaign SKAN trials/subscribes with cost_per_skan_trial / cost_per_skan_subscribe (skan_campaign_efficiency), reconciliation vs RevenueCat truth (skan_reconciliation), and blended CAC per trial/subscription (cross_network_blended). Unmapped source ids show as campaign_key 'src:NNNN' — add them to skan_campaign_mapping.",
      {},
      async () => {
        if (!SUPABASE_URL || !SUPABASE_ANON) {
          return fail("Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
        }
        const readView = async (view: string) => {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*`, {
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`Supabase ${view} read failed: ${res.status}`);
          return (await res.json()) as Array<Record<string, unknown>>;
        };
        try {
          const [efficiency, reconciliation, blended, health, payback] = await Promise.all([
            readView("skan_campaign_efficiency"),
            readView("skan_reconciliation"),
            readView("cross_network_blended"),
            readView("skan_health").catch(() => []),
            readView("payback_summary").catch(() => []),
          ]);
          const unmapped = efficiency
            .map((r) => r.campaign_key)
            .filter((k): k is string => typeof k === "string" && k.startsWith("src:"));
          return json({
            reconciliation: reconciliation[0] ?? null,
            blended: blended[0] ?? null,
            payback: payback[0] ?? null,
            health: health[0] ?? null,
            campaigns: efficiency,
            unmapped_source_ids: unmapped,
            note:
              unmapped.length > 0
                ? "Unmapped SKAN source ids present — insert rows into skan_campaign_mapping to attribute them."
                : "No unmapped source ids.",
          });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- READ: anomaly alerts (Singular-style) ----------------------------
    server.tool(
      "marketing_alerts",
      "Unresolved marketing anomaly alerts from the last N days (spend/CPI/CTR/CPM z-score anomalies per campaign + account, written daily by the marketing-alerts cron).",
      { days: z.number().int().min(1).max(30).default(3) },
      async ({ days }) => {
        if (!SUPABASE_URL || !SUPABASE_ANON) {
          return fail("Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).");
        }
        try {
          const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/marketing_alerts?select=*&alert_date=gte.${since}&resolved_at=is.null&order=alert_date.desc,severity.desc`,
            {
              headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
              cache: "no-store",
            },
          );
          if (!res.ok) return fail(`marketing_alerts read failed: ${res.status}`);
          const alerts = (await res.json()) as Array<Record<string, unknown>>;
          return json({ days, count: alerts.length, alerts });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- WRITE: URL tags (per-ad UTM attribution) --------------------------
    // url_tags lives on the AdCreative and is immutable after creation, so this
    // creates a sibling creative that reuses the SAME underlying post
    // (effective_object_story_id → social proof preserved) with url_tags set,
    // then points the ad at it. NOTE: swapping an ad's creative counts as a
    // significant edit → re-review + learning reset on that ad.
    const DEFAULT_URL_TAGS =
      "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}";
    server.tool(
      "set_url_tags",
      "Add UTM url_tags to ads so the app's deferred-deep-link resolver can pipe per-ad attribution into RevenueCat (media_source/campaign/ad). Creates a url_tags-bearing copy of each ad's creative (same post — keeps social proof) and swaps the ad onto it. Skips ads that already carry the tags; only_active (default) skips non-ACTIVE ads. Significant edit: re-review + learning reset per ad. Guarded: requires confirm:true.",
      {
        ad_ids: z.array(z.string()).min(1).max(50),
        url_tags: z.string().default(DEFAULT_URL_TAGS),
        only_active: z.boolean().default(true),
        confirm: z.boolean().default(false).describe("Must be true to actually apply the change"),
        dry_run: z.boolean().default(false),
      },
      async ({ ad_ids, url_tags, only_active, confirm, dry_run }) => {
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        const ver = process.env.META_API_VERSION ?? "v22.0";
        const account = meta.account.startsWith("act_") ? meta.account : `act_${meta.account}`;
        const G = `https://graph.facebook.com/${ver}`;
        const auth = { Authorization: `Bearer ${meta.token}` };

        type AdInfo = {
          id: string;
          name?: string;
          effective_status?: string;
          creative?: {
            id: string;
            name?: string;
            url_tags?: string;
            effective_object_story_id?: string;
            object_story_spec?: Record<string, unknown>;
          };
        };

        const results: Array<Record<string, unknown>> = [];
        for (const adId of ad_ids) {
          try {
            const infoRes = await fetch(
              `${G}/${adId}?fields=name,effective_status,creative{id,name,url_tags,effective_object_story_id,object_story_spec}`,
              { headers: auth, cache: "no-store" },
            );
            const info = (await infoRes.json()) as AdInfo & { error?: { message: string } };
            if (!infoRes.ok) {
              results.push({ ad_id: adId, status: "error", error: info.error?.message ?? `HTTP ${infoRes.status}` });
              continue;
            }
            if (only_active && info.effective_status !== "ACTIVE") {
              results.push({ ad_id: adId, ad_name: info.name, status: "skipped_not_active", effective_status: info.effective_status });
              continue;
            }
            if (info.creative?.url_tags === url_tags) {
              results.push({ ad_id: adId, ad_name: info.name, status: "already_tagged" });
              continue;
            }
            if (dry_run || !confirm) {
              results.push({
                ad_id: adId,
                ad_name: info.name,
                status: dry_run ? "dry_run_would_tag" : "needs_confirm",
                current_url_tags: info.creative?.url_tags ?? null,
                via: info.creative?.effective_object_story_id ? "object_story_id" : "object_story_spec",
              });
              continue;
            }

            // Build the replacement creative.
            const body: Record<string, string> = {
              name: `${info.creative?.name ?? info.name ?? adId} +utm`,
              url_tags,
            };
            if (info.creative?.effective_object_story_id) {
              body.object_story_id = info.creative.effective_object_story_id;
            } else if (info.creative?.object_story_spec) {
              body.object_story_spec = JSON.stringify(info.creative.object_story_spec);
            } else {
              results.push({ ad_id: adId, ad_name: info.name, status: "error", error: "creative has neither effective_object_story_id nor object_story_spec" });
              continue;
            }
            const createRes = await fetch(`${G}/${account}/adcreatives`, {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams(body).toString(),
            });
            const created = (await createRes.json()) as { id?: string; error?: { message: string } };
            if (!createRes.ok || !created.id) {
              results.push({ ad_id: adId, ad_name: info.name, status: "error", error: created.error?.message ?? `creative create HTTP ${createRes.status}` });
              continue;
            }
            const swapRes = await fetch(`${G}/${adId}`, {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ creative: JSON.stringify({ creative_id: created.id }) }).toString(),
            });
            const swapped = (await swapRes.json()) as { success?: boolean; error?: { message: string } };
            if (!swapRes.ok) {
              results.push({ ad_id: adId, ad_name: info.name, status: "error", error: swapped.error?.message ?? `creative swap HTTP ${swapRes.status}`, orphan_creative_id: created.id });
              continue;
            }
            results.push({ ad_id: adId, ad_name: info.name, status: "tagged", new_creative_id: created.id });
          } catch (e) {
            results.push({ ad_id: adId, status: "error", error: e instanceof Error ? e.message : String(e) });
          }
        }
        return json({ url_tags, applied: confirm && !dry_run, results });
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

    // --- WRITE: bulk operations -----------------------------------------
    server.tool(
      "bulk_update",
      "Apply pause / activate / set-budget to many entities (campaigns, ad sets, or ads) in one call. Each op: {id, action: PAUSE|ACTIVATE|SET_BUDGET, daily_budget_cents?}. SET_BUDGET only applies to ad sets/campaigns. Runs sequentially and returns a per-op result. Guarded: requires confirm:true.",
      {
        operations: z
          .array(
            z.object({
              id: z.string(),
              action: z.enum(["PAUSE", "ACTIVATE", "SET_BUDGET"]),
              daily_budget_cents: z.number().int().min(100).optional(),
            }),
          )
          .min(1)
          .max(100),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async ({ operations, confirm, dry_run }) => {
        if (dry_run) {
          return json({
            dry_run: true,
            count: operations.length,
            would: operations.map((o) => ({ id: o.id, action: o.action, ...(o.action === "SET_BUDGET" ? { daily_budget_usd: o.daily_budget_cents ? r(o.daily_budget_cents / 100) : null } : {}) })),
          });
        }
        if (!confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);

        const results: Array<{ id: string; action: string; ok: boolean; error?: string }> = [];
        for (const op of operations) {
          try {
            if (op.action === "SET_BUDGET") {
              if (!op.daily_budget_cents) throw new Error("daily_budget_cents required for SET_BUDGET");
              await updateEntityDailyBudget({ id: op.id, dailyBudgetCents: op.daily_budget_cents, accessToken: meta.token });
            } else {
              await updateEntityStatus({ id: op.id, status: op.action === "PAUSE" ? "PAUSED" : "ACTIVE", accessToken: meta.token });
            }
            results.push({ id: op.id, action: op.action, ok: true });
          } catch (e) {
            results.push({ id: op.id, action: op.action, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        const applied = results.filter((x) => x.ok).length;
        return json({ applied, failed: results.length - applied, results });
      },
    );

    // --- READ: ad creative essentials (for rebuild-from-video) -----------
    // When /copies is blocked by Meta's dev-mode-app restriction (1885183),
    // read each ad's video_id + copy here, then feed batch_create_video_ads
    // (video_id path + url_tags) to rebuild fresh creatives the connected app
    // owns. The uploaded VIDEO asset is reusable; only the original post isn't.
    server.tool(
      "get_ad_creative_info",
      "Read creative essentials off existing ads: video_id, message, headline, link, page_id, effective_status. Use with batch_create_video_ads (video_id + url_tags) to rebuild ads as fresh creatives when duplication is blocked by the dev-mode-app restriction.",
      { ad_ids: z.array(z.string()).min(1).max(50) },
      async ({ ad_ids }) => {
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        try {
          const rows = await fetchAdCreativeInfo({ adIds: ad_ids, accessToken: meta.token });
          return json({ count: rows.length, rows });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- WRITE: create ads from EXISTING posts (preserve social proof) ----
    // The correct "duplicate but keep likes/comments" path. /copies clones the
    // post (new zero-engagement object_story_id); this instead references each
    // source ad's ORIGINAL effective_object_story_id via "Use Existing Post",
    // so the new ad inherits the post's accumulated social proof. url_tags is
    // baked into the creative without forking the post. New ads are PAUSED.
    const UTM_DEFAULT =
      "utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}";
    server.tool(
      "create_ads_from_posts",
      "Recreate ads in a target ad set while PRESERVING social proof: references each source ad's original post (object_story_id) via Use-Existing-Post instead of /copies (which clones the post to a zero-engagement copy). Bakes url_tags in without forking. New ads are PAUSED. items=[{source_ad_id, target_adset_id, name?}]. Guarded: requires confirm:true.",
      {
        items: z
          .array(
            z.object({
              source_ad_id: z.string(),
              target_adset_id: z.string(),
              name: z.string().optional(),
            }),
          )
          .min(1)
          .max(50),
        url_tags: z.string().default(UTM_DEFAULT),
        status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async ({ items, url_tags, status, confirm, dry_run }) => {
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        const account = meta.account.startsWith("act_") ? meta.account : `act_${meta.account}`;
        const results: Array<Record<string, unknown>> = [];
        for (const it of items) {
          try {
            const storyId = await getAdObjectStoryId({ adId: it.source_ad_id, accessToken: meta.token });
            if (!storyId) {
              results.push({ source_ad_id: it.source_ad_id, status: "error", error: "no effective_object_story_id (ad has no shared post — can't preserve social proof)" });
              continue;
            }
            if (dry_run || !confirm) {
              results.push({
                source_ad_id: it.source_ad_id,
                target_adset_id: it.target_adset_id,
                object_story_id: storyId,
                status: dry_run ? "dry_run_would_create" : "needs_confirm",
              });
              continue;
            }
            const name = it.name ?? `existing-post ${it.source_ad_id}`;
            const creativeId = await createExistingPostCreative({
              accountId: account,
              name,
              objectStoryId: storyId,
              urlTags: url_tags,
              accessToken: meta.token,
            });
            const adId = await createAd({
              accountId: account,
              adsetId: it.target_adset_id,
              name,
              creativeId,
              status,
              accessToken: meta.token,
            });
            results.push({
              source_ad_id: it.source_ad_id,
              new_ad_id: adId,
              new_creative_id: creativeId,
              object_story_id: storyId,
              target_adset_id: it.target_adset_id,
              status: "created",
            });
          } catch (e) {
            results.push({ source_ad_id: it.source_ad_id, status: "error", error: e instanceof Error ? e.message : String(e) });
          }
        }
        const created = results.filter((r) => r.status === "created").length;
        return json({ created, failed: results.filter((r) => r.status === "error").length, applied: confirm && !dry_run, results });
      },
    );

    // --- WRITE: batch creative upload (video → ads) ---------------------
    const DEFAULT_MSG = "Your GLP-1 journey, made simple. Track your progress and stay motivated with DreamMe.";
    server.tool(
      "batch_create_video_ads",
      "Upload videos (by public file_url) and build app-install VIDEO creatives; optionally create PAUSED ads in a target ad set. Each video: {file_url? OR video_id?, name?, message?, headline?}. Google Drive share links do NOT work as file_url — use a direct/public URL or a pre-uploaded Meta video_id. Optional url_tags bakes UTMs into each new creative. Guarded: requires confirm:true.",
      {
        videos: z
          .array(
            z.object({
              file_url: z.string().optional(),
              video_id: z.string().optional(),
              name: z.string().optional(),
              message: z.string().optional(),
              headline: z.string().optional(),
            }),
          )
          .min(1)
          .max(10),
        adset_id: z.string().optional().describe("If set, also create a PAUSED ad per video in this ad set"),
        account_id: z.string().optional().describe("Target ad account (defaults to the connection's default)"),
        message: z.string().optional().describe("Shared ad copy (per-video message overrides)"),
        headline: z.string().optional(),
        link: z.string().optional().describe("Destination link; defaults to the DreamMe App Store URL"),
        url_tags: z
          .string()
          .optional()
          .describe(
            "UTM query string (no leading ?) baked into each new creative, e.g. utm_source=facebook&utm_campaign={{campaign.name}}&utm_medium={{adset.name}}&utm_content={{ad.name}}",
          ),
        status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async (a) => {
        if (a.dry_run) {
          return json({
            dry_run: true,
            count: a.videos.length,
            adset_id: a.adset_id ?? "(creatives only — no ads)",
            would: a.videos.map((v, i) => ({ source: v.file_url ?? v.video_id ?? "(missing)", name: v.name ?? `MCP video ${i + 1}` })),
          });
        }
        if (!a.confirm) return fail("Refusing to apply: pass confirm:true (or dry_run:true to preview).");
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        const account = a.account_id ? normAcct(a.account_id) : meta.account;

        const results: Array<Record<string, unknown>> = [];
        for (let i = 0; i < a.videos.length; i++) {
          const v = a.videos[i];
          const name = v.name ?? `MCP video ${i + 1}`;
          try {
            if (!v.file_url && !v.video_id) throw new Error("each video needs file_url or video_id");
            const videoId = v.video_id ?? (await uploadVideoByUrl({ accountId: account, fileUrl: v.file_url!, name, accessToken: meta.token }));
            const ready = await waitForVideoReady({ videoId, accessToken: meta.token });
            if (ready === "error") throw new Error("Meta reported video processing error");
            if (ready === "processing") {
              results.push({ name, video_id: videoId, ok: false, status: "pending", error: "video still processing after timeout — re-run with this video_id later" });
              continue;
            }
            const thumbUri = await getVideoThumbnail({ videoId, accessToken: meta.token });
            if (!thumbUri) throw new Error("no thumbnail available for video yet — retry shortly");
            const imageHash = await uploadImageByUrl({ accountId: account, imageUrl: thumbUri, accessToken: meta.token });
            const creativeId = await createVideoCreative({
              accountId: account,
              name,
              videoId,
              imageHash,
              message: v.message ?? a.message ?? DEFAULT_MSG,
              headline: v.headline ?? a.headline ?? "Meet DreamMe",
              link: a.link,
              urlTags: a.url_tags,
              accessToken: meta.token,
            });
            let adId: string | undefined;
            if (a.adset_id) {
              adId = await createAd({ accountId: account, adsetId: a.adset_id, name, creativeId, status: a.status, accessToken: meta.token });
            }
            results.push({ name, video_id: videoId, creative_id: creativeId, ad_id: adId, status: adId ? a.status : "creative-only", ok: true });
          } catch (e) {
            results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        const ok = results.filter((x) => x.ok).length;
        return json({ created: ok, failed: results.length - ok, results, note: "New ads/creatives validate async — re-check in 1-2 min." });
      },
    );

    // --- WRITE: delete --------------------------------------------------
    server.tool(
      "delete_entity",
      "Permanently delete a Meta entity by id — campaign, ad set, ad, ad creative, or uploaded video. IRREVERSIBLE. Guarded: requires confirm:true (use dry_run:true to preview).",
      {
        id: z.string().describe("The campaign / ad set / ad / creative / video id to delete"),
        confirm: z.boolean().default(false),
        dry_run: z.boolean().default(false),
      },
      async (a) => {
        if (a.dry_run) return json({ dry_run: true, would_delete: a.id });
        if (!a.confirm) return fail("Refusing to delete: pass confirm:true (or dry_run:true to preview). This is irreversible.");
        const meta = await resolveMeta();
        if (!meta) return fail(NO_META);
        try {
          const res = await deleteEntity({ id: a.id, accessToken: meta.token });
          return json({ deleted: a.id, success: res.success });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- WRITE: audience sync (Module 4) --------------------------------
    server.tool(
      "sync_audiences",
      "Run the RC→Meta audience sync: snapshot active payers, build/refresh the suppression + high-LTV lookalike + win-back audiences, and exclude suppression from active prospecting ad sets. Guarded: defaults to dry_run (no Meta writes — snapshot + read-only discovery only). To apply live, pass dry_run:false AND confirm:true.",
      {
        dry_run: z.boolean().default(true).describe("Default true — no Meta writes."),
        confirm: z.boolean().default(false).describe("Required with dry_run:false to actually create/modify Meta audiences + ad sets."),
        window_days: z.number().optional().describe("RC enumeration window in days (default 180)."),
      },
      async (a) => {
        const live = a.dry_run === false;
        if (live && !a.confirm) return fail("Refusing live audience sync: pass confirm:true (or leave dry_run:true to preview).");
        try {
          return json(await runAudienceSync({ dryRun: !live, windowDays: a.window_days }));
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );

    // --- WRITE: attach suppression to prospecting ad sets ---------------
    server.tool(
      "attach_suppression",
      "Exclude the active-subscriber suppression audience from prospecting ad sets (auto-discovered active app-promo ad sets, or an explicit adset_ids list). Guarded: defaults to dry_run; to apply pass dry_run:false AND confirm:true.",
      {
        adset_ids: z.array(z.string()).optional().describe("Explicit ad set ids; omit to auto-discover active prospecting ad sets."),
        dry_run: z.boolean().default(true),
        confirm: z.boolean().default(false),
      },
      async (a) => {
        const live = a.dry_run === false;
        if (live && !a.confirm) return fail("Refusing live attach: pass confirm:true (or leave dry_run:true to preview).");
        try {
          return json(await attachSuppression({ dryRun: !live, adsetIds: a.adset_ids }));
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
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
