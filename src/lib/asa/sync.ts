/**
 * Daily Apple Ads sync into the asa_* tables (migration 0120).
 *
 * Reads, never writes, the Apple Ads account. Each run:
 *   1. campaigns, ad groups, keywords and negative keywords as they are now;
 *   2. daily campaign and keyword reports for the last `days` days (default
 *      14, since Apple revises recent days; 90 is the most a daily report takes);
 *   3. search terms for the last 30 days, replacing the previous window.
 * Report days are in the org's time zone (America/New_York, "ORTZ").
 */
import { spDelete, spPost } from "@/lib/support/db";
import { appleTime, asaList, asaReport, money, type Money } from "./client";

interface Campaign {
  id: number;
  name: string;
  status: string;
  servingStatus: string;
  displayStatus?: string;
  servingStateReasons?: string[] | null;
  dailyBudgetAmount?: Money | null;
  startTime?: string | null;
  endTime?: string | null;
  countriesOrRegions?: string[];
  deleted?: boolean;
}
interface AdGroup {
  id: number;
  campaignId: number;
  name: string;
  status: string;
  servingStatus: string;
  servingStateReasons?: string[] | null;
  defaultBidAmount?: Money | null;
  automatedKeywordsOptIn?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  deleted?: boolean;
}
interface Keyword {
  id: number;
  campaignId: number;
  adGroupId: number;
  text: string;
  matchType: string;
  status: string;
  bidAmount?: Money | null;
  deleted?: boolean;
}
interface Negative {
  id: number;
  campaignId: number;
  adGroupId?: number | null;
  text: string;
  matchType: string;
  status: string;
}
interface Metrics {
  impressions?: number;
  taps?: number;
  tapInstalls?: number;
  viewInstalls?: number;
  tapNewDownloads?: number;
  localSpend?: Money;
  date?: string;
}
interface ReportRow {
  metadata: Record<string, unknown>;
  granularity?: Metrics[];
  total?: Metrics;
}
interface ReportResponse {
  data?: { reportingDataResponse?: { row?: ReportRow[] } };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function reportBody(start: string, end: string, daily: boolean) {
  return {
    startTime: start,
    endTime: end,
    timeZone: "ORTZ",
    ...(daily ? { granularity: "DAILY" } : {}),
    selector: { orderBy: [{ field: "impressions", sortOrder: "DESCENDING" }], pagination: { offset: 0, limit: 1000 } },
    returnRowTotals: !daily,
    returnRecordsWithNoMetrics: false,
    returnGrandTotals: false,
  };
}

const metricCols = (m: Metrics) => ({
  impressions: m.impressions ?? 0,
  taps: m.taps ?? 0,
  tap_installs: m.tapInstalls ?? 0,
  view_installs: m.viewInstalls ?? 0,
  tap_new_downloads: m.tapNewDownloads ?? 0,
  spend: money(m.localSpend) ?? 0,
});

async function upsert(table: string, rows: unknown[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    await spPost(table, rows.slice(i, i + 500), { onConflict, resolution: "merge" });
  }
}

export interface AsaSyncResult {
  ok: boolean;
  campaigns: number;
  ad_groups: number;
  keywords: number;
  campaign_days: number;
  keyword_days: number;
  search_terms: number;
  window: { start: string; end: string };
  errors: string[];
}

export async function syncAsa(opts: { days?: number; now?: Date } = {}): Promise<AsaSyncResult> {
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90);
  const end = ymd(now);
  const start = ymd(new Date(now.getTime() - (days - 1) * 86_400_000));
  const stStart = ymd(new Date(now.getTime() - 29 * 86_400_000));
  const syncedAt = now.toISOString();
  const errors: string[] = [];
  const res: AsaSyncResult = {
    ok: false, campaigns: 0, ad_groups: 0, keywords: 0, campaign_days: 0, keyword_days: 0, search_terms: 0,
    window: { start, end }, errors,
  };

  // 1. Structure
  const campaigns = await asaList<Campaign>("/campaigns");
  await upsert(
    "asa_campaigns",
    campaigns.map((c) => ({
      campaign_id: c.id,
      name: c.name,
      status: c.status,
      serving_status: c.servingStatus,
      display_status: c.displayStatus ?? null,
      serving_reasons: c.servingStateReasons ?? [],
      daily_budget: money(c.dailyBudgetAmount),
      currency: c.dailyBudgetAmount?.currency ?? null,
      start_time: appleTime(c.startTime),
      end_time: appleTime(c.endTime),
      countries: c.countriesOrRegions ?? [],
      deleted: !!c.deleted,
      synced_at: syncedAt,
    })),
    "campaign_id",
  );
  res.campaigns = campaigns.length;

  for (const c of campaigns) {
    try {
      const groups = await asaList<AdGroup>(`/campaigns/${c.id}/adgroups`);
      await upsert(
        "asa_ad_groups",
        groups.map((g) => ({
          ad_group_id: g.id,
          campaign_id: g.campaignId,
          name: g.name,
          status: g.status,
          serving_status: g.servingStatus,
          serving_reasons: g.servingStateReasons ?? [],
          default_bid: money(g.defaultBidAmount),
          search_match: g.automatedKeywordsOptIn ?? null,
          start_time: appleTime(g.startTime),
          end_time: appleTime(g.endTime),
          deleted: !!g.deleted,
          synced_at: syncedAt,
        })),
        "ad_group_id",
      );
      res.ad_groups += groups.length;

      const negatives: Negative[] = await asaList<Negative>(`/campaigns/${c.id}/negativekeywords`);
      for (const g of groups) {
        const kws = await asaList<Keyword>(`/campaigns/${c.id}/adgroups/${g.id}/targetingkeywords`);
        await upsert(
          "asa_keywords",
          kws.map((k) => ({
            keyword_id: k.id,
            campaign_id: k.campaignId ?? c.id,
            ad_group_id: k.adGroupId ?? g.id,
            keyword: k.text,
            match_type: k.matchType,
            status: k.status,
            bid: money(k.bidAmount),
            deleted: !!k.deleted,
            synced_at: syncedAt,
          })),
          "keyword_id",
        );
        res.keywords += kws.length;
        negatives.push(...(await asaList<Negative>(`/campaigns/${c.id}/adgroups/${g.id}/negativekeywords`)));
      }
      if (negatives.length) {
        await upsert(
          "asa_negative_keywords",
          negatives.map((n) => ({
            negative_id: n.id,
            campaign_id: n.campaignId ?? c.id,
            ad_group_id: n.adGroupId ?? null,
            text: n.text,
            match_type: n.matchType,
            status: n.status,
            synced_at: syncedAt,
          })),
          "negative_id",
        );
      }
    } catch (e) {
      errors.push(`structure ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Daily reports
  try {
    const r = await asaReport<ReportResponse>("/reports/campaigns", reportBody(start, end, true));
    const rows = (r.data?.reportingDataResponse?.row ?? []).flatMap((row) =>
      (row.granularity ?? []).map((m) => ({
        day: m.date,
        campaign_id: Number(row.metadata.campaignId),
        ...metricCols(m),
        synced_at: syncedAt,
      })),
    );
    await upsert("asa_campaign_daily", rows, "day,campaign_id");
    res.campaign_days = rows.length;
  } catch (e) {
    errors.push(`campaign report: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const c of campaigns) {
    try {
      const r = await asaReport<ReportResponse>(`/reports/campaigns/${c.id}/keywords`, reportBody(start, end, true));
      const rows = (r.data?.reportingDataResponse?.row ?? []).flatMap((row) => {
        const md = row.metadata;
        return (row.granularity ?? []).map((m) => ({
          day: m.date,
          keyword_id: Number(md.keywordId),
          campaign_id: Number(md.campaignId ?? c.id),
          ad_group_id: Number(md.adGroupId),
          keyword: String(md.keyword ?? ""),
          match_type: (md.matchType as string) ?? null,
          keyword_status: (md.keywordStatus as string) ?? null,
          bid: money(md.bidAmount as Money | undefined),
          ...metricCols(m),
          synced_at: syncedAt,
        }));
      });
      await upsert("asa_keyword_daily", rows, "day,keyword_id");
      res.keyword_days += rows.length;
    } catch (e) {
      errors.push(`keyword report ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. Search terms, last 30 days (Apple refuses returnRecordsWithNoMetrics=true here)
  for (const c of campaigns) {
    try {
      const r = await asaReport<ReportResponse>(`/reports/campaigns/${c.id}/searchterms`, reportBody(stStart, end, false));
      const rows = (r.data?.reportingDataResponse?.row ?? []).map((row) => {
        const md = row.metadata;
        return {
          window_start: stStart,
          window_end: end,
          campaign_id: c.id,
          ad_group_id: md.adGroupId != null ? Number(md.adGroupId) : null,
          keyword_id: md.keywordId != null ? Number(md.keywordId) : null,
          keyword: (md.keyword as string) ?? null,
          search_term: (md.searchTermText as string) ?? null,
          source: (md.searchTermSource as string) ?? null,
          ...(({ impressions, taps, tap_installs, spend }) => ({ impressions, taps, tap_installs, spend }))(
            metricCols(row.total ?? {}),
          ),
          synced_at: syncedAt,
        };
      });
      await spDelete(`asa_search_terms?campaign_id=eq.${c.id}`);
      if (rows.length) await spPost("asa_search_terms", rows);
      res.search_terms += rows.length;
    } catch (e) {
      errors.push(`search terms ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  res.ok = errors.length === 0;
  return res;
}
