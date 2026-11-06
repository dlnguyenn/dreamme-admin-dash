/**
 * Live Meta reads for the MMP tab: each ad's trial mix by age (insights
 * breakdown) and each active ad set's optimization event. Server-only; uses
 * the dashboard's Meta connection. Cached for an hour per server instance,
 * because the tab is opened a few times a day and both answers move slowly.
 */
import { resolveMetaToken } from "@/lib/meta-oauth";
import { metaAgeBand, type AgeMix } from "./payers";

const API_VERSION = process.env.META_API_VERSION ?? "v22.0";
const TTL_MS = 60 * 60 * 1000;

export interface AdSetInfo {
  id: string;
  name: string;
  campaign_name: string | null;
  optimization_goal: string | null;
  /** The app event or custom event the ad set optimizes for, when it names one. */
  event: string | null;
  effective_status: string | null;
}

export interface MetaLive {
  ageMix: Record<string, AgeMix>;
  adsets: AdSetInfo[];
  fetchedAt: string;
}

let cache: { at: number; value: MetaLive } | null = null;

async function getAll<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = (await res.json()) as { data?: T[]; paging?: { next?: string }; error?: { message?: string; code?: number } };
    if (!res.ok || body.error) throw new Error(`Meta ${res.status}: ${body.error?.message ?? "request failed"}`);
    out.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }
  return out;
}

type AgeRow = { ad_id?: string; age?: string; conversions?: Array<{ action_type: string; value: string }> };
type AdSetRow = {
  id: string;
  name: string;
  campaign?: { name?: string };
  optimization_goal?: string;
  promoted_object?: { custom_event_type?: string; custom_event_str?: string; custom_conversion_id?: string };
  effective_status?: string;
};

export async function fetchMetaLive(now: Date = new Date()): Promise<MetaLive> {
  if (cache && now.getTime() - cache.at < TTL_MS) return cache.value;
  const meta = await resolveMetaToken();
  if (!meta) throw new Error("No Meta connection: reconnect on the Integrations tab");
  const account = meta.account.startsWith("act_") ? meta.account : `act_${meta.account}`;
  const until = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);

  const ageQs = new URLSearchParams({
    level: "ad",
    breakdowns: "age",
    fields: "ad_id,conversions",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
  });
  const adsetQs = new URLSearchParams({
    fields: "id,name,campaign{name},optimization_goal,promoted_object,effective_status",
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: "200",
  });

  const [ageRows, adsetRows] = await Promise.all([
    getAll<AgeRow>(`https://graph.facebook.com/${API_VERSION}/${account}/insights?${ageQs}`, meta.token),
    getAll<AdSetRow>(`https://graph.facebook.com/${API_VERSION}/${account}/adsets?${adsetQs}`, meta.token),
  ]);

  const ageMix: Record<string, AgeMix> = {};
  for (const r of ageRows) {
    const band = metaAgeBand(String(r.age ?? ""));
    if (!band || !r.ad_id) continue;
    // start_trial_total already rolls up the channel types (see vendors/meta-ads.ts).
    const trials = (r.conversions ?? []).filter((c) => c.action_type === "start_trial_total").reduce((a, c) => a + (Number(c.value) || 0), 0);
    if (trials <= 0) continue;
    const mix = (ageMix[r.ad_id] ??= {});
    mix[band] = (mix[band] ?? 0) + trials;
  }

  const adsets: AdSetInfo[] = adsetRows.map((a) => ({
    id: a.id,
    name: a.name,
    campaign_name: a.campaign?.name ?? null,
    optimization_goal: a.optimization_goal ?? null,
    event: a.promoted_object?.custom_event_type ?? a.promoted_object?.custom_event_str ?? null,
    effective_status: a.effective_status ?? null,
  }));

  const value = { ageMix, adsets, fetchedAt: now.toISOString() };
  cache = { at: now.getTime(), value };
  return value;
}
