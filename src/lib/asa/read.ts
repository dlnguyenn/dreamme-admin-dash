/**
 * Builds the Apple Ads tab payload from the asa_* tables (never calls Apple).
 */
import { spGet } from "@/lib/support/db";
import { asaConfigured } from "./client";
import {
  campaignWarnings,
  matchCampaign,
  readTest,
  windowStart,
  type AsaCampaignRow,
  type AsaDailyRow,
  type AsaKeywordDailyRow,
  type AsaTest,
  type TestRead,
  type Warning,
} from "./logic";

/** Today in the Apple Ads org's time zone (America/New_York), YYYY-MM-DD. */
export function orgToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface AsaAdGroupRow {
  ad_group_id: number;
  campaign_id: number;
  name: string;
  status: string | null;
  serving_status: string | null;
  default_bid: number | null;
  search_match: boolean | null;
}
export interface AsaKeywordRow {
  keyword_id: number;
  campaign_id: number;
  ad_group_id: number;
  keyword: string;
  match_type: string | null;
  status: string | null;
  bid: number | null;
  deleted: boolean;
}
export interface AsaSearchTermRow {
  campaign_id: number;
  ad_group_id: number | null;
  keyword: string | null;
  search_term: string | null;
  source: string | null;
  impressions: number;
  taps: number;
  tap_installs: number;
  spend: number;
  window_start: string;
  window_end: string;
}
export interface AsaNegativeRow {
  campaign_id: number;
  ad_group_id: number | null;
  text: string;
  match_type: string | null;
  status: string | null;
}
interface RcAsaEvent {
  type: string;
  period_type: string | null;
  event_at: string;
  app_user_id: string | null;
  asa_campaign: string | null;
  asa_ad_group: string | null;
  asa_keyword: string | null;
}

export interface AsaPayload {
  ok: true;
  configured: boolean;
  today: string;
  synced_at: string | null;
  campaigns: (AsaCampaignRow & { warnings: Warning[]; is_test: boolean })[];
  ad_groups: AsaAdGroupRow[];
  keywords: AsaKeywordRow[];
  daily: AsaDailyRow[];
  keyword_daily: AsaKeywordDailyRow[];
  search_terms: AsaSearchTermRow[];
  negatives: AsaNegativeRow[];
  attribution: {
    proven: boolean;
    first_seen: string | null;
    events_90d: number;
    trials_by_campaign: Record<string, number>;
    trials_by_keyword: Record<string, number>; // key: `${campaign_id}|${keyword lowercased}`
    unmatched_trials: number;
    trial_days: { day: string; campaign_id: number | null }[];
  };
  tests: (AsaTest & { read: TestRead })[];
}

const num = <T extends object>(rows: T[], keys: (keyof T)[]): T[] =>
  rows.map((r) => {
    const o = { ...r } as Record<string, unknown>;
    for (const k of keys) if (o[k as string] != null) o[k as string] = Number(o[k as string]);
    return o as T;
  });

export async function buildAsaPayload(now: Date = new Date()): Promise<AsaPayload> {
  const today = orgToday(now);
  const from90 = windowStart(today, 90);
  const [campaigns, adGroups, keywords, daily, kwDaily, terms, negatives, tests, rcEvents] = await Promise.all([
    spGet<AsaCampaignRow[]>("asa_campaigns?select=*&order=campaign_id"),
    spGet<AsaAdGroupRow[]>("asa_ad_groups?select=ad_group_id,campaign_id,name,status,serving_status,default_bid,search_match&deleted=eq.false"),
    spGet<AsaKeywordRow[]>("asa_keywords?select=keyword_id,campaign_id,ad_group_id,keyword,match_type,status,bid,deleted&deleted=eq.false"),
    spGet<AsaDailyRow[]>(`asa_campaign_daily?select=day,campaign_id,impressions,taps,tap_installs,view_installs,spend&day=gte.${from90}&order=day`),
    spGet<AsaKeywordDailyRow[]>(`asa_keyword_daily?select=day,keyword_id,campaign_id,ad_group_id,keyword,match_type,bid,impressions,taps,tap_installs,view_installs,spend&day=gte.${from90}&order=day`),
    spGet<AsaSearchTermRow[]>("asa_search_terms?select=campaign_id,ad_group_id,keyword,search_term,source,impressions,taps,tap_installs,spend,window_start,window_end&order=impressions.desc&limit=500"),
    spGet<AsaNegativeRow[]>("asa_negative_keywords?select=campaign_id,ad_group_id,text,match_type,status"),
    spGet<AsaTest[]>("asa_tests?select=*"),
    spGet<RcAsaEvent[]>(`asa_rc_events?select=type,period_type,event_at,app_user_id,asa_campaign,asa_ad_group,asa_keyword&event_at=gte.${from90}T00:00:00Z&order=event_at`),
  ]);

  const dailyN = num(daily, ["impressions", "taps", "tap_installs", "view_installs", "spend", "campaign_id"]);
  const kwDailyN = num(kwDaily, ["impressions", "taps", "tap_installs", "view_installs", "spend", "bid", "campaign_id", "keyword_id", "ad_group_id"]);
  const campaignsN = num(campaigns, ["daily_budget", "campaign_id"]);

  // Trials = a RevenueCat INITIAL_PURCHASE on a trial, once per user.
  const seen = new Set<string>();
  const trialsByCampaign: Record<string, number> = {};
  const trialsByKeyword: Record<string, number> = {};
  const trialDays: { day: string; campaign_id: number | null }[] = [];
  let unmatched = 0;
  for (const e of rcEvents) {
    if (e.type !== "INITIAL_PURCHASE" || e.period_type !== "TRIAL") continue;
    const who = e.app_user_id ?? `${e.event_at}`;
    if (seen.has(who)) continue;
    seen.add(who);
    const cid = matchCampaign(e.asa_campaign, campaignsN);
    if (cid == null) unmatched++;
    else trialsByCampaign[cid] = (trialsByCampaign[cid] ?? 0) + 1;
    if (cid != null && e.asa_keyword) {
      const k = `${cid}|${e.asa_keyword.trim().toLowerCase()}`;
      trialsByKeyword[k] = (trialsByKeyword[k] ?? 0) + 1;
    }
    trialDays.push({ day: orgToday(new Date(e.event_at)), campaign_id: cid });
  }
  const proven = rcEvents.length > 0;

  const testIds = new Set(tests.map((t) => Number(t.campaign_id)));
  const testsOut = num(tests, ["campaign_id", "keep_cost_per_trial", "stop_cost_per_trial", "length_days"]).map((t) => {
    const c = campaignsN.find((x) => x.campaign_id === t.campaign_id);
    const firstRead = readTest(t, c, dailyN, null, today);
    const from = firstRead.started_on;
    const trials = proven
      ? trialDays.filter((d) => d.campaign_id === t.campaign_id && (!from || d.day >= from)).length
      : null;
    return { ...t, read: readTest(t, c, dailyN, trials, today) };
  });

  const syncedAt = campaigns.map((c) => c.synced_at).sort().at(-1) ?? null;

  return {
    ok: true,
    configured: asaConfigured(),
    today,
    synced_at: syncedAt,
    campaigns: campaignsN
      .filter((c) => !c.deleted)
      .map((c) => ({
        ...c,
        is_test: testIds.has(c.campaign_id),
        warnings: campaignWarnings(c, dailyN, testIds.has(c.campaign_id), today),
      })),
    ad_groups: num(adGroups, ["default_bid", "campaign_id", "ad_group_id"]),
    keywords: num(keywords, ["bid", "campaign_id", "ad_group_id", "keyword_id"]),
    daily: dailyN,
    keyword_daily: kwDailyN,
    search_terms: num(terms, ["impressions", "taps", "tap_installs", "spend", "campaign_id", "ad_group_id"]),
    negatives: num(negatives, ["campaign_id", "ad_group_id"]),
    attribution: {
      proven,
      first_seen: rcEvents[0]?.event_at ?? null,
      events_90d: rcEvents.length,
      trials_by_campaign: trialsByCampaign,
      trials_by_keyword: trialsByKeyword,
      unmatched_trials: unmatched,
      trial_days: trialDays,
    },
    tests: testsOut,
  };
}
