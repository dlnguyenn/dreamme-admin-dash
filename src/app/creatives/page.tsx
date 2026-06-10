/**
 * /creatives — read-only analytics surface backed by Supabase tables that
 * are populated by the daily sync crons (`sync-ad-insights`,
 * `sync-qualified-trials`).
 *
 * Replaces "open Ads Manager and squint." Shows per-ad thumbnail +
 * spend/CTR/trial-start counts + blended qualified CPA (account-level
 * qualified rate applied uniformly — same caveat as the qualified-CPA
 * script).
 *
 * Server component. Reads via Supabase REST + service role.
 */

import { SUPABASE_URL } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

interface AdRow {
  ad_id: string;
  date: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string | null;
  effective_status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: number;
  creative_id: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  message: string | null;
  headline: string | null;
}

interface QualifiedRow {
  date: string;
  count: number;
}

interface AdAggregated {
  ad_id: string;
  ad_name: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  message: string;
  headline: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: number;
  ctr: number;
  cpm: number;
  cpc: number;
  reported_trial_cpa: number;
}

function fmtUSD(n: number, frac = 2): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: frac,
  });
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
function fmtPct(n: number, frac = 1): string {
  return `${(n * 100).toFixed(frac)}%`;
}
function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface DateRange {
  since: string;
  until: string;
  label: string;
}
function resolveRange(rangeParam: string | undefined): DateRange {
  const now = new Date();
  const until = isoDate(now);
  switch (rangeParam) {
    case "1d":
      return { since: until, until, label: "Today" };
    case "14d": {
      const since = new Date(now.getTime() - 13 * 86_400_000);
      return { since: isoDate(since), until, label: "Last 14 days" };
    }
    case "30d": {
      const since = new Date(now.getTime() - 29 * 86_400_000);
      return { since: isoDate(since), until, label: "Last 30 days" };
    }
    case "7d":
    default: {
      const since = new Date(now.getTime() - 6 * 86_400_000);
      return { since: isoDate(since), until, label: "Last 7 days" };
    }
  }
}

async function sbGet<T>(path: string): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Supabase env missing");
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function loadAdRows(range: DateRange): Promise<AdRow[]> {
  return sbGet<AdRow[]>(
    `ad_insights_daily?select=*&date=gte.${range.since}&date=lte.${range.until}&order=date.desc&limit=10000`,
  );
}

async function loadQualifiedTrials(range: DateRange): Promise<QualifiedRow[]> {
  return sbGet<QualifiedRow[]>(
    `qualified_trials_daily?select=*&date=gte.${range.since}&date=lte.${range.until}`,
  );
}

function aggregateByAd(rows: AdRow[]): AdAggregated[] {
  const map = new Map<string, AdAggregated>();
  for (const r of rows) {
    const k = r.ad_id;
    let a = map.get(k);
    if (!a) {
      a = {
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? "(unnamed)",
        adset_name: r.adset_name ?? "",
        campaign_id: r.campaign_id ?? "",
        campaign_name: r.campaign_name ?? "",
        status: r.status ?? "",
        thumbnail_url: r.thumbnail_url,
        image_url: r.image_url,
        video_id: r.video_id,
        message: r.message ?? "",
        headline: r.headline ?? "",
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        trial_starts: 0,
        purchases: 0,
        purchase_value: 0,
        ctr: 0,
        cpm: 0,
        cpc: 0,
        reported_trial_cpa: 0,
      };
      map.set(k, a);
    }
    a.spend += Number(r.spend) || 0;
    a.impressions += Number(r.impressions) || 0;
    a.clicks += Number(r.clicks) || 0;
    a.installs += Number(r.installs) || 0;
    a.trial_starts += Number(r.trial_starts) || 0;
    a.purchases += Number(r.purchases) || 0;
    a.purchase_value += Number(r.purchase_value) || 0;
  }
  const out = [...map.values()];
  for (const a of out) {
    a.ctr = safeDiv(a.clicks, a.impressions);
    a.cpm = safeDiv(a.spend * 1000, a.impressions);
    a.cpc = safeDiv(a.spend, a.clicks);
    a.reported_trial_cpa = safeDiv(a.spend, a.trial_starts);
  }
  return out.sort((a, b) => b.spend - a.spend);
}

export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; campaign?: string }>;
}) {
  const params = await searchParams;
  const range = resolveRange(params.range);

  let adRows: AdRow[] = [];
  let qualifiedRows: QualifiedRow[] = [];
  let loadError: string | null = null;
  try {
    [adRows, qualifiedRows] = await Promise.all([
      loadAdRows(range),
      loadQualifiedTrials(range),
    ]);
  } catch (e) {
    loadError = (e as Error).message;
  }

  // Optional campaign filter via URL query (?campaign=<id>)
  const filteredAdRows = params.campaign
    ? adRows.filter((r) => r.campaign_id === params.campaign)
    : adRows;

  const ads = aggregateByAd(filteredAdRows);

  // Totals across the WHOLE returned set (not just the filtered campaign)
  // for the account-level qualified rate calculation.
  const allAds = aggregateByAd(adRows);
  const totals = allAds.reduce(
    (acc, a) => {
      acc.spend += a.spend;
      acc.impressions += a.impressions;
      acc.clicks += a.clicks;
      acc.installs += a.installs;
      acc.trial_starts += a.trial_starts;
      acc.purchases += a.purchases;
      acc.purchase_value += a.purchase_value;
      return acc;
    },
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      installs: 0,
      trial_starts: 0,
      purchases: 0,
      purchase_value: 0,
    },
  );
  const totalQualified = qualifiedRows.reduce(
    (s, r) => s + (Number(r.count) || 0),
    0,
  );
  const qualifiedRate = safeDiv(totalQualified, totals.trial_starts);
  const trueQualifiedCpa = safeDiv(totals.spend, totalQualified);
  const reportedTrialCpa = safeDiv(totals.spend, totals.trial_starts);

  // Unique campaigns for the filter chips
  const campaigns = [
    ...new Map(
      adRows.map((r) => [
        r.campaign_id ?? "",
        { id: r.campaign_id ?? "", name: r.campaign_name ?? "(no campaign)" },
      ]),
    ).values(),
  ].filter((c) => c.id);

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Creatives</h1>
            <p className="text-sm text-neutral-500">
              Per-ad analytics with thumbnails. Joined Meta insights + n8n
              qualified-trial counts. Synced daily by{" "}
              <code className="text-xs">sync-ad-insights</code> +{" "}
              <code className="text-xs">sync-qualified-trials</code>.
            </p>
          </div>
          <div className="flex gap-2">
            {(["1d", "7d", "14d", "30d"] as const).map((r) => {
              const active = (params.range ?? "7d") === r;
              const href = `/creatives?range=${r}${params.campaign ? `&campaign=${params.campaign}` : ""}`;
              return (
                <a
                  key={r}
                  href={href}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    active
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {r}
                </a>
              );
            })}
          </div>
        </header>

        {loadError ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&apos;t load data: {loadError}
          </div>
        ) : null}

        {/* Account summary */}
        <section className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-neutral-200 bg-white p-6 md:grid-cols-4">
          <Stat label={`Spend · ${range.label}`} value={fmtUSD(totals.spend)} />
          <Stat label="Installs" value={fmtInt(totals.installs)} />
          <Stat
            label="Trial starts (Meta)"
            value={fmtInt(totals.trial_starts)}
            sub={`reported CPA ${fmtUSD(reportedTrialCpa)}`}
          />
          <Stat
            label="Qualified trials (n8n)"
            value={fmtInt(totalQualified)}
            sub={`rate ${fmtPct(qualifiedRate)} · true CPA ${fmtUSD(trueQualifiedCpa)}`}
            accent
          />
        </section>

        {/* Campaign filter chips */}
        {campaigns.length > 1 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <a
              href={`/creatives?range=${params.range ?? "7d"}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                !params.campaign
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              All campaigns
            </a>
            {campaigns.map((c) => (
              <a
                key={c.id}
                href={`/creatives?range=${params.range ?? "7d"}&campaign=${c.id}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  params.campaign === c.id
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white text-neutral-700"
                }`}
              >
                {c.name}
              </a>
            ))}
          </div>
        ) : null}

        {/* Ad grid */}
        {ads.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center text-sm text-neutral-500">
            No ad data for this window yet. Run{" "}
            <code>sync-ad-insights</code> + <code>sync-qualified-trials</code>{" "}
            crons or wait 24h for the next sync.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {ads.map((a) => {
              const estQualified = a.trial_starts * qualifiedRate;
              const blendedQualifiedCpa = safeDiv(a.spend, estQualified);
              return (
                <article
                  key={a.ad_id}
                  className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
                >
                  <div className="relative aspect-[4/5] bg-neutral-100">
                    {a.thumbnail_url ? (
                      <img
                        src={a.thumbnail_url}
                        alt={a.ad_name}
                        className="h-full w-full object-cover"
                      />
                    ) : a.image_url ? (
                      <img
                        src={a.image_url}
                        alt={a.ad_name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                        no preview
                      </div>
                    )}
                    {a.video_id ? (
                      <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-white">
                        ▶ video
                      </span>
                    ) : null}
                    {a.status && a.status !== "ACTIVE" ? (
                      <span className="absolute left-2 top-2 rounded-full bg-neutral-900/80 px-2 py-0.5 text-xs uppercase tracking-wide text-white">
                        {a.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-3">
                    <h3
                      className="truncate text-sm font-semibold text-neutral-900"
                      title={a.ad_name}
                    >
                      {a.ad_name}
                    </h3>
                    <p
                      className="truncate text-xs text-neutral-500"
                      title={a.adset_name}
                    >
                      {a.adset_name}
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-neutral-500">Spend</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {fmtUSD(a.spend)}
                      </dd>
                      <dt className="text-neutral-500">CTR</dt>
                      <dd className="text-right tabular-nums">
                        {a.ctr > 0 ? fmtPct(a.ctr, 2) : "—"}
                      </dd>
                      <dt className="text-neutral-500">Installs</dt>
                      <dd className="text-right tabular-nums">
                        {fmtInt(a.installs)}
                      </dd>
                      <dt className="text-neutral-500">Trials</dt>
                      <dd className="text-right tabular-nums">
                        {fmtInt(a.trial_starts)}
                      </dd>
                      <dt className="text-neutral-500">Reported CPA</dt>
                      <dd className="text-right tabular-nums">
                        {a.trial_starts > 0
                          ? fmtUSD(a.reported_trial_cpa)
                          : "—"}
                      </dd>
                      <dt className="text-neutral-500">
                        Qual CPA<span className="text-rose-600">*</span>
                      </dt>
                      <dd className="text-right font-semibold tabular-nums text-rose-700">
                        {a.trial_starts > 0 && qualifiedRate > 0
                          ? fmtUSD(blendedQualifiedCpa)
                          : "—"}
                      </dd>
                    </dl>
                    <a
                      href={`https://business.facebook.com/adsmanager/manage/ads?act=1575502753719515&selected_ad_ids=${a.ad_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 block rounded-md border border-neutral-300 px-2 py-1 text-center text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    >
                      Open in Ads Manager →
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-xs text-neutral-500">
          <span className="text-rose-600">*</span> Qualified CPA applies the
          account-level qualified rate uniformly to each ad. Per-ad qualified
          rate isn&apos;t measurable until the iOS SDK captures fbc/fbp on
          install. Ranking by Qual CPA equals ranking by Reported CPA (constant
          multiplier); the column is for absolute numbers, not for picking
          winners.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-rose-700" : "text-neutral-900"}`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}
