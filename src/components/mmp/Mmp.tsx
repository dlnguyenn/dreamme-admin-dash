"use client";

/**
 * MMP tab (?tab=mmp): AppsFlyer, module by module, against what the DAD
 * already runs in its place.
 *
 * Summary     what an MMP is for, how much we can attribute today, each
 *             attribution method side by side per campaign
 * Parity      every AppsFlyer module with our status and live evidence
 * How it works  AppsFlyer's attribution rules next to ours
 * AGA         what App Growth Annual 2026 speakers said about MMPs
 * Plan        the ordered steps to match it, and what can't be copied
 *
 * Live numbers come from one GET /api/mmp (migration 0098); statuses are
 * computed in src/lib/mmp/parity.ts, text lives in src/lib/mmp/catalog.ts.
 */

import * as React from "react";
import { PageHeader } from "../Shell";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, HeroCard, InfoWell, SectionHeader, Segmented, StatStrip, StatusPill, thStyle } from "../porcelain";
import { int, pct, tableCard, tdStyle, usd } from "../plan/format";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  AREAS,
  STATUS_LABEL,
  buildParity,
  coverage,
  groupAdsBySet,
  MIN_TRIALS_FOR_RATE,
  scoreboard,
  singularRead,
  trialToPaid,
  type MmpAdRow,
  type MmpCampaignRow,
  type MmpSnapshot,
  type ParityRow,
  type ParityStatus,
} from "@/lib/mmp/parity";
import { AGA_NOTES, AGA_SUMMARY, BUY_OPTION, CANT_COPY, JOBS, MECHANICS, PLAN, type MmpJob } from "@/lib/mmp/catalog";
import {
  AGE_BANDS,
  BENCHMARKS,
  MIN_BAND_TRIALS,
  ageRates,
  checkAdSets,
  costPerPayer,
  summarizeAsc,
  type AdSetWeek,
  type AgeMix,
  type AgeRateRow,
  type AscSourceRow,
  type Verdict,
} from "@/lib/mmp/payers";
import type { MetaLive } from "@/lib/mmp/meta-live";

type View = "summary" | "checks" | "parity" | "how" | "aga" | "plan";
const VIEWS: { value: View; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "checks", label: "Checks" },
  { value: "parity", label: "Parity" },
  { value: "how", label: "How AppsFlyer works" },
  { value: "aga", label: "AGA" },
  { value: "plan", label: "Plan" },
];
const VIEW_KEY = "dreamme.mmp.view";

const PILL: Record<ParityStatus, "success" | "attention" | "neutral" | "danger"> = {
  live: "success",
  partial: "attention",
  idle: "neutral",
  broken: "danger",
  missing: "danger",
  blocked: "neutral",
  skip: "neutral",
};

const VERDICT: Record<MmpJob["verdict"], { label: string; kind: "success" | "attention" | "neutral" }> = {
  built: { label: "Mostly built", kind: "success" },
  partly: { label: "Little to do", kind: "neutral" },
  cant: { label: "Partner only", kind: "attention" },
};

const body: React.CSSProperties = { font: "400 13px/1.55 var(--font-ui)", color: "var(--ink-2)", margin: 0 };
const muted: React.CSSProperties = { font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)", margin: 0 };
const cellLabel: React.CSSProperties = {
  font: "650 10.5px var(--font-ui)",
  color: "var(--ink-3)",
  marginBottom: 4,
};

interface Payload {
  snapshot: MmpSnapshot;
  campaigns: MmpCampaignRow[];
  ads: MmpAdRow[];
  ageRates: AgeRateRow[];
  adsetWeek: AdSetWeek[];
  asc: AscSourceRow[];
  meta: MetaLive | null;
  metaError: string | null;
}

export function Mmp() {
  const [view, setView] = React.useState<View>("summary");
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (VIEWS.some((v) => v.value === saved)) setView(saved as View);
    } catch {}
  }, []);
  const pick = (v: string) => {
    setView(v as View);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mmp", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData({
        snapshot: json.snapshot,
        campaigns: json.campaigns,
        ads: json.ads ?? [],
        ageRates: json.ageRates ?? [],
        adsetWeek: json.adsetWeek ?? [],
        asc: json.asc ?? [],
        meta: json.meta ?? null,
        metaError: json.metaError ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = React.useMemo(() => (data ? buildParity(data.snapshot) : []), [data]);
  const needsData = view === "summary" || view === "parity" || view === "checks";

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Growth"
        title="MMP"
        subtitle="What AppsFlyer does, what the DAD already does in its place, and what is left to match it."
        actions={
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", maxWidth: "100%" }}>
            <div style={{ maxWidth: "100%", overflowX: "auto" }}>
              <Segmented value={view} onChange={pick} options={VIEWS} />
            </div>
            <Button variant="secondary" icon={<Icons.Refresh />} onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          </span>
        }
      />
      {error && needsData && <ErrorBanner>{error}</ErrorBanner>}
      {needsData && !data && !error && <InfoWell>Loading…</InfoWell>}
      {view === "summary" && data && <Summary data={data} rows={rows} />}
      {view === "checks" && data && <Checks data={data} />}
      {view === "parity" && data && <Parity rows={rows} />}
      {view === "how" && <HowItWorks />}
      {view === "aga" && <Aga />}
      {view === "plan" && <Plan />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function Summary({ data, rows }: { data: Payload; rows: ParityRow[] }) {
  const s = data.snapshot;
  const score = scoreboard(rows);
  const sng = singularRead(s);
  const cov = coverage(s);

  return (
    <>
      <InfoWell style={{ marginBottom: 16 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>
          A mobile measurement partner (MMP) such as AppsFlyer or Singular says which ad drove each install and what that user went on to pay.
        </strong>{" "}
        It does three jobs. Two can be built in-house and mostly are. The third is access that ad networks give only to certified partners.
      </InfoWell>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {JOBS.map((j, i) => (
          <Card key={j.title}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ font: "650 15px var(--font-ui)" }}>
                {i + 1}. {j.title}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <StatusPill kind={VERDICT[j.verdict].kind}>{VERDICT[j.verdict].label}</StatusPill>
              </span>
            </div>
            <p style={{ ...muted, marginBottom: 10 }}>{j.what}</p>
            <p style={body}>{j.dreamme}</p>
          </Card>
        ))}
      </div>

      <SectionHeader family="accent" icon="Link" title="Where the DAD stands" meta="last 35 days" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <HeroCard
          label="Trials tied to an ad by our own match"
          value={`${int(s.trials_click_matched)} of ${int(s.trials)}`}
          delta={s.trials ? pct(s.trials_click_matched / s.trials) : undefined}
          deltaUp={false}
          note="Only website-objective campaigns on the /l link can be matched. Everything else rests on Meta's claims, SKAN and the survey."
        />
        <StatStrip
          minColWidth={110}
          stats={[
            { label: "Live", value: score.live, note: "running" },
            { label: "Partial", value: score.partial, note: "covers part" },
            { label: "Idle", value: score.idle, note: "built, no traffic" },
            { label: "Broken", value: score.broken, note: "needs a fix" },
            { label: "Not built", value: score.missing, note: "can be built" },
            { label: "Can't copy", value: score.blocked, note: "partner-only" },
          ]}
        />
      </div>

      <SectionHeader family="info" icon="Chart" title="How many trials each method can see" meta="of RevenueCat's trials · 35 days" />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {cov.map((c) => {
            const ratio = c.of > 0 ? c.value / c.of : 0;
            return (
              <div key={c.id}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 5, flexWrap: "wrap" }}>
                  <span style={{ font: "650 13px var(--font-ui)" }}>{c.label}</span>
                  <span style={{ ...muted, fontSize: 12 }}>{c.note}</span>
                  <span style={{ marginLeft: "auto", font: "650 13px var(--font-ui)", fontVariantNumeric: "tabular-nums" }}>
                    {int(c.value)} <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>· {pct(ratio, ratio < 0.1 ? 1 : 0)}</span>
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, ratio * 100)}%`,
                      minWidth: c.value > 0 ? 3 : 0,
                      height: "100%",
                      borderRadius: 999,
                      background: ratio > 1 ? "var(--warning)" : "var(--accent)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ ...muted, marginTop: 14 }}>
          Meta&rsquo;s bar is over 100% when it claims more trials than RevenueCat counted from every source. The survey adds a split with no campaign:{" "}
          {pct(s.survey_total ? (s.survey_facebook + s.survey_instagram) / s.survey_total : null, 0)} of {int(s.survey_total)} onboarding answers said Facebook or Instagram,{" "}
          {pct(s.survey_total ? s.survey_app_store / s.survey_total : null, 0)} the App Store and {pct(s.survey_total ? s.survey_tiktok / s.survey_total : null, 0)} TikTok.
        </p>
      </Card>

      <SectionHeader family="neutral" icon="Layers" title="Every method, by campaign" meta="35 days" />
      <CampaignTable rows={data.campaigns} />

      <SectionHeader family="neutral" icon="Image" title="By ad set and ad: Meta against Singular" meta="35 days" />
      <AdTable rows={data.ads} paidFlowing={data.snapshot.sng_paid_35d > 0} />

      <SectionHeader family="accent" icon="Dollar" title="Estimated cost per payer, by ad" meta="35 days · $100+ spend" />
      <PayerTable data={data} />

      <SectionHeader family="neutral" icon="Chart" title="Trial-to-paid by age" meta="RevenueCat trials 10-120 days old" />
      <AgeTable rows={data.ageRates} />

      <SectionHeader family="neutral" icon="InfoCircle" title="Singular, the MMP already in the app" />
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <StatusPill kind={PILL[sng.status]}>{sng.status === "idle" ? "No trials yet" : sng.status === "partial" ? "No cost" : STATUS_LABEL[sng.status]}</StatusPill>
          <span style={body}>{sng.evidence}</span>
        </div>
        <p style={muted}>
          The Singular SDK has shipped since app v1.3.8 and a daily cron pulls its reports. Singular is a certified Meta partner, so these counts come from the row-level data Meta gives
          only to partners. Trials are counted in the 7 days after install. Cost comes from Singular&rsquo;s Facebook data connector, which has returned nothing since October.
        </p>
      </Card>
    </>
  );
}

function CampaignTable({ rows }: { rows: MmpCampaignRow[] }) {
  if (!rows.length) return <InfoWell>No campaign spend in the last 35 days.</InfoWell>;
  const dash = <span style={{ color: "var(--ink-4)" }}>—</span>;
  return (
    <Card pad={0} style={tableCard}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Campaign", "Spend", "Meta installs", "Meta-claimed trials", "Singular installs", "Singular trials", "SKAN trials", "/l clicks", "Matched installs", "Matched trials"].map((h, i) => (
              <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.campaign_id}>
              <td style={{ ...tdStyle("left"), fontWeight: 650 }}>{r.campaign_name ?? r.campaign_id}</td>
              <td style={tdStyle()}>{usd(r.spend, 0)}</td>
              <td style={tdStyle()}>{r.meta_installs ? int(r.meta_installs) : dash}</td>
              <td style={tdStyle()}>{r.meta_trials ? int(r.meta_trials) : dash}</td>
              <td style={tdStyle()}>{r.singular_installs ? int(r.singular_installs) : dash}</td>
              <td style={tdStyle()}>{r.singular_trials ? int(r.singular_trials) : dash}</td>
              <td style={tdStyle()}>{r.skan_trials == null ? dash : int(r.skan_trials)}</td>
              <td style={tdStyle()}>{r.clicks ? int(r.clicks) : dash}</td>
              <td style={tdStyle()}>{r.matched_installs ? int(r.matched_installs) : dash}</td>
              <td style={tdStyle()}>{r.matched_trials ? int(r.matched_trials) : dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Ad sets with their ads underneath. Cost per trial is Meta's spend divided by
 * each count. On iOS, Meta's claimed trials run about three times Singular's
 * and SKAN's, so the Singular column is the one to rank on.
 */
function AdTable({ rows, paidFlowing }: { rows: MmpAdRow[]; paidFlowing: boolean }) {
  const { groups, hiddenAds, hiddenSets, hiddenSpend } = groupAdsBySet(rows);
  const anySingular = rows.some((r) => r.singular_installs > 0);
  if (!groups.length) return <InfoWell>No ad spend in the last 35 days.</InfoWell>;
  const dash = <span style={{ color: "var(--ink-4)" }}>—</span>;
  const cpt = (spend: number, trials: number) => (spend > 0 && trials > 0 ? usd(spend / trials) : dash);
  const t2p = (trialsMature: number, paidMature: number) => {
    const rate = paidFlowing ? trialToPaid(trialsMature, paidMature) : null;
    return rate == null ? dash : (
      <span title={`${int(paidMature)} of ${int(trialsMature)} trials from installs at least 14 days old`}>{pct(rate, 0)}</span>
    );
  };
  const cells = (spend: number, metaTrials: number, sInstalls: number, sTrials: number, tMature: number, pMature: number) => (
    <>
      <td style={tdStyle()}>{spend > 0 ? usd(spend, 0) : dash}</td>
      <td style={tdStyle()}>{metaTrials ? int(metaTrials) : dash}</td>
      <td style={tdStyle()}>{sInstalls ? int(sInstalls) : dash}</td>
      <td style={tdStyle()}>{sTrials ? int(sTrials) : dash}</td>
      <td style={tdStyle()}>{cpt(spend, metaTrials)}</td>
      <td style={{ ...tdStyle(), fontWeight: 650 }}>{cpt(spend, sTrials)}</td>
      <td style={{ ...tdStyle(), fontWeight: 650 }}>{t2p(tMature, pMature)}</td>
    </>
  );
  return (
    <>
      {!anySingular && (
        <InfoWell style={{ marginBottom: 12 }}>
          Singular&rsquo;s ad-level rows land with the next daily sync (17:00 UTC). Until then only Meta&rsquo;s columns are filled.
        </InfoWell>
      )}
      {anySingular && !paidFlowing && (
        <InfoWell style={{ marginBottom: 12 }}>
          <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>Trial-to-paid is waiting on RevenueCat&rsquo;s events.</strong> Turn on
          RevenueCat&rsquo;s Singular integration and register <code>rc_trial_converted</code> in Singular (docs/singular-mmp-setup.md, step 6). The column
          fills on the next sync after events arrive, for installs at least 14 days old.
        </InfoWell>
      )}
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Ad set / ad", "Spend", "Meta-claimed trials", "Singular installs", "Singular trials", "Cost per Meta trial", "Cost per Singular trial", "Trial-to-paid"].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={`${g.campaign_name}${g.adset_id}`}>
                <tr style={{ background: "var(--surface-2)" }}>
                  <td style={{ ...tdStyle("left"), fontWeight: 650 }}>
                    {g.adset_name ?? g.adset_id ?? "Unknown ad set"}
                    <span style={{ fontWeight: 400, color: "var(--ink-3)" }}> · {g.campaign_name}</span>
                  </td>
                  {cells(g.spend, g.meta_trials, g.singular_installs, g.singular_trials, g.singular_trials_mature, g.singular_paid_mature)}
                </tr>
                {g.ads.map((a) => (
                  <tr key={`${g.adset_id}${a.ad_id ?? "na"}`}>
                    <td style={{ ...tdStyle("left"), paddingLeft: 32, color: a.ad_id ? "var(--ink)" : "var(--ink-3)" }}>
                      {a.ad_id ? a.ad_name ?? a.ad_id : "Ad not named by Singular"}
                    </td>
                    {cells(a.spend, a.meta_trials, a.singular_installs, a.singular_trials, a.singular_trials_mature, a.singular_paid_mature)}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </Card>
      <p style={{ ...muted, marginTop: 10 }}>
        {paidFlowing
          ? `Trial-to-paid uses installs at least 14 days old, and only where there are ${MIN_TRIALS_FOR_RATE} or more such trials. `
          : "Trials, not payers, until RevenueCat's events reach Singular. "}
        Cost per Singular trial is an upper bound, since Singular only counts users it can attribute.
        {hiddenAds > 0 && ` ${hiddenAds} ads under $25 with no Singular trials are counted in their ad set but not listed.`}
        {hiddenSets > 0 && ` ${hiddenSets} smaller ad sets with no Singular data (${usd(hiddenSpend, 0)} in all, mostly website-campaign tests) are left out.`}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cost per payer and age
// ---------------------------------------------------------------------------

const dashEl = <span style={{ color: "var(--ink-4)" }}>—</span>;

/**
 * Burke's method: an ad's trials x its likely trial-to-paid (its Meta age mix
 * weighted by our real rate per age band). Ranks ads on payers, not trials.
 */
function PayerTable({ data }: { data: Payload }) {
  const mixes = data.meta?.ageMix ?? {};
  const rates = { ios: ageRates(data.ageRates, { ios: true }), all: ageRates(data.ageRates) };
  const ads = data.ads
    .filter((a): a is MmpAdRow & { ad_id: string } => a.ad_id != null)
    .map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad_name,
      adset_name: a.adset_name,
      campaign_name: a.campaign_name,
      spend: a.spend,
      meta_trials: a.meta_trials,
      singular_trials: a.singular_trials,
    }));
  const all = costPerPayer(ads, mixes, rates);
  const rows = all.filter((r) => r.trials > 0);
  const noTrials = all.length - rows.length;
  if (!data.meta) {
    return (
      <InfoWell>
        Meta&rsquo;s age breakdown didn&rsquo;t load{data.metaError ? ` (${data.metaError})` : ""}, so cost per payer can&rsquo;t be estimated right now.
      </InfoWell>
    );
  }
  if (!rows.length) return <InfoWell>No ad has $100 of spend in the last 35 days.</InfoWell>;
  const vs = (v: number | null) => {
    if (v == null) return dashEl;
    const color = v <= 0.85 ? "var(--success)" : v >= 1.15 ? "var(--danger)" : "var(--ink-2)";
    return <span style={{ color, fontWeight: 650 }}>{v <= 1 ? `${pct(1 - v, 0)} cheaper` : `${pct(v - 1, 0)} dearer`}</span>;
  };
  return (
    <>
      {rates.all.known < 0.2 && (
        <InfoWell style={{ marginBottom: 12 }}>
          <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>Ages haven&rsquo;t synced yet</strong> ({pct(rates.all.known, 0)} of trials have one), so every ad
          gets the same overall trial-to-paid and this table ranks on trials only. It fills in after the next user-sources sync.
        </InfoWell>
      )}
      <InfoWell style={{ marginBottom: 12 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>Trial-to-paid differs by age, and each ad pulls a different age mix.</strong> Each ad&rsquo;s
        likely trial-to-paid is its trial-start age mix from Meta, weighted by DreamMe&rsquo;s real trial-to-paid in each age band (table below). Payers = trials
        x that rate. iOS ads use Singular&rsquo;s trials; Android ads use Meta&rsquo;s claims, which run high, so compare each ad only with others on the same basis.
      </InfoWell>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Ad", "Spend", "Trials", "Basis", "Aged 45+", "Likely trial-to-paid", "Payers", "Cost per payer", "Against average"].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ad_id}>
                <td style={tdStyle("left")}>
                  <span style={{ fontWeight: 650 }}>{r.ad_name ?? r.ad_id}</span>
                  <span style={{ color: "var(--ink-3)" }}> · {r.adset_name ?? r.campaign_name}</span>
                </td>
                <td style={tdStyle()}>{usd(r.spend, 0)}</td>
                <td style={tdStyle()}>{r.trials ? int(r.trials) : dashEl}</td>
                <td style={{ ...tdStyle(), color: "var(--ink-3)" }}>{r.basis === "singular" ? "Singular" : "Meta"}</td>
                <td style={tdStyle()}>{r.over45 == null ? dashEl : pct(r.over45, 0)}</td>
                <td style={tdStyle()}>{r.trialToPaid == null ? dashEl : pct(r.trialToPaid, 0)}</td>
                <td style={tdStyle()}>{r.payers == null ? dashEl : r.payers.toFixed(1)}</td>
                <td style={{ ...tdStyle(), fontWeight: 650 }}>{r.costPerPayer == null ? dashEl : usd(r.costPerPayer, 0)}</td>
                <td style={tdStyle()}>{vs(r.vsAverage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p style={{ ...muted, marginTop: 10 }}>
        An estimate: it assumes users of one age convert the same whichever ad brought them. Once Singular reports real payers per ad (Trial-to-paid column above),
        trust that over this.
        {noTrials > 0 && ` ${noTrials} iOS ads with $100+ spend have no Singular trials yet (new, or Singular reports their ad as N/A) and aren't listed.`}
      </p>
    </>
  );
}

function AgeTable({ rows }: { rows: AgeRateRow[] }) {
  if (!rows.length) return <InfoWell>No trials old enough to have converted.</InfoWell>;
  const all = ageRates(rows);
  const ios = ageRates(rows, { ios: true });
  const order = ["under 18", ...AGE_BANDS, "unknown"];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.age_band) - order.indexOf(b.age_band));
  const rate = (c: number, t: number) => (t >= MIN_BAND_TRIALS ? pct(c / t, 0) : t > 0 ? <span style={{ color: "var(--ink-3)" }}>{pct(c / t, 0)}*</span> : dashEl);
  return (
    <>
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Age", "Trials", "Paid", "Trial-to-paid", "iOS trials", "iOS trial-to-paid"].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.age_band}>
                <td style={{ ...tdStyle("left"), fontWeight: 650, color: r.age_band === "unknown" ? "var(--ink-3)" : undefined }}>{r.age_band}</td>
                <td style={tdStyle()}>{int(r.trials)}</td>
                <td style={tdStyle()}>{int(r.converted)}</td>
                <td style={{ ...tdStyle(), fontWeight: 650 }}>{rate(r.converted, r.trials)}</td>
                <td style={tdStyle()}>{int(r.trials_ios)}</td>
                <td style={tdStyle()}>{rate(r.converted_ios, r.trials_ios)}</td>
              </tr>
            ))}
            <tr style={{ background: "var(--surface-2)" }}>
              <td style={{ ...tdStyle("left"), fontWeight: 650 }}>All</td>
              <td style={tdStyle()}>{int(rows.reduce((a, r) => a + r.trials, 0))}</td>
              <td style={tdStyle()}>{int(rows.reduce((a, r) => a + r.converted, 0))}</td>
              <td style={{ ...tdStyle(), fontWeight: 650 }}>{all.overall == null ? dashEl : pct(all.overall, 1)}</td>
              <td style={tdStyle()}>{int(rows.reduce((a, r) => a + r.trials_ios, 0))}</td>
              <td style={tdStyle()}>{ios.overall == null ? dashEl : pct(ios.overall, 1)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <p style={{ ...muted, marginTop: 10 }}>
        Age comes from the birthday entered in onboarding ({pct(all.known, 0)} of trials have one; the picker&rsquo;s default 1995-01-01 counts as unknown). *
        Fewer than {MIN_BAND_TRIALS} trials: the cost-per-payer estimate uses the overall rate for that band instead.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Checks: weekly benchmarks, optimization volume, App Store sources
// ---------------------------------------------------------------------------

const VERDICT_PILL: Record<Verdict | "good", { kind: "success" | "attention" | "neutral" | "danger"; label: string }> = {
  ok: { kind: "success", label: "OK" },
  good: { kind: "success", label: "Good" },
  low: { kind: "danger", label: "Low" },
  thin: { kind: "neutral", label: "Too small" },
};

function Checks({ data }: { data: Payload }) {
  const checks = checkAdSets(data.adsetWeek);
  const settings = new Map((data.meta?.adsets ?? []).map((a) => [a.id, a]));
  const asc = summarizeAsc(data.asc);
  const flagged = checks.filter((c) => c.clickVerdict === "low" || c.trialVerdict === "low" || c.volumeVerdict === "low").length;
  const rateCell = (v: number | null, verdict: Verdict) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      {v == null ? dashEl : pct(v, 0)}
      {verdict !== "ok" && <StatusPill kind={VERDICT_PILL[verdict].kind}>{VERDICT_PILL[verdict].label}</StatusPill>}
    </span>
  );

  return (
    <>
      <InfoWell style={{ marginBottom: 16 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>Three checks an MMP dashboard would flag, run on the last 7 full days.</strong> Benchmarks are from the AGA
        2026 talks: Meta click to install around {pct(BENCHMARKS.clickToInstall, 0)}, install to trial over {pct(BENCHMARKS.installToTrial, 0)}, and{" "}
        {BENCHMARKS.minWeeklyEvents}-{BENCHMARKS.goodWeeklyEvents} optimization events per ad set per week so Meta can learn. The marketing-alerts cron writes the same
        checks to the alerts feed each morning.
      </InfoWell>

      <SectionHeader
        family={flagged ? "attention" : "success"}
        icon="TriAlert"
        title="Funnel benchmarks and learning volume, by ad set"
        meta={`last 7 days · ${flagged} flagged`}
      />
      {checks.length ? (
        <Card pad={0} style={tableCard}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Ad set", "Optimizes for", "Spend", "Clicks", "Installs", "Click to install", "Install to trial", "Trial starts (events)"].map((h, i) => (
                  <th key={h} style={thStyle(i < 2 ? "left" : "right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => {
                const s = settings.get(c.adset_id);
                const goal = s ? (s.event ?? s.optimization_goal ?? "—").toString().replace(/_/g, " ").toLowerCase() : null;
                return (
                  <tr key={c.adset_id}>
                    <td style={tdStyle("left")}>
                      <span style={{ fontWeight: 650 }}>{c.adset_name ?? c.adset_id}</span>
                      <span style={{ color: "var(--ink-3)" }}> · {c.campaign_name}</span>
                    </td>
                    <td style={{ ...tdStyle("left"), color: "var(--ink-3)" }}>{goal ?? (data.meta ? "not active" : dashEl)}</td>
                    <td style={tdStyle()}>{usd(c.spend, 0)}</td>
                    <td style={tdStyle()}>{int(c.clicks)}</td>
                    <td style={tdStyle()}>{int(c.installs)}</td>
                    <td style={tdStyle()}>{rateCell(c.clickToInstall, c.clickVerdict)}</td>
                    <td style={tdStyle()}>{rateCell(c.installToTrial, c.trialVerdict)}</td>
                    <td style={tdStyle()}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        {int(c.trials)}
                        <StatusPill kind={VERDICT_PILL[c.volumeVerdict].kind}>{VERDICT_PILL[c.volumeVerdict].label}</StatusPill>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <InfoWell>No ad set spent in the last 7 days.</InfoWell>
      )}
      <p style={{ ...muted, marginTop: 10 }}>
        Clicks, installs and trial starts are Meta&rsquo;s own counts, since those are what its optimizer learns from. Below ${BENCHMARKS.minWeeklySpend} of weekly spend
        the rates are too noisy to judge. Under {BENCHMARKS.minWeeklyEvents} events a week, an ad set stays in learning: consolidate it or optimize for an earlier event.
        {data.metaError && ` Ad set settings didn't load (${data.metaError}).`}
      </p>

      <SectionHeader family="info" icon="Flag" title="App Store downloads by source" meta={asc.lastDate ? `35 days to ${asc.lastDate}` : "no data"} />
      <AscCard asc={asc} />
    </>
  );
}

function AscCard({ asc }: { asc: ReturnType<typeof summarizeAsc> }) {
  if (!asc.rows.length) {
    return (
      <InfoWell>
        No App Store download data yet. Load it with <code>npm run asc:downloads</code> (Apple&rsquo;s App Downloads Detailed report).
      </InfoWell>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {asc.rows.map((r) => {
            const share = asc.total > 0 ? r.downloads / asc.total : 0;
            const isMeta = r.bucket === "Facebook app" || r.bucket === "Instagram app";
            return (
              <div key={r.bucket}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 5 }}>
                  <span style={{ font: "650 13px var(--font-ui)" }}>{r.bucket}</span>
                  <span style={{ marginLeft: "auto", font: "650 13px var(--font-ui)", fontVariantNumeric: "tabular-nums" }}>
                    {int(r.downloads)} <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>· {pct(share, 0)}</span>
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, share * 100)}%`,
                      minWidth: r.downloads > 0 ? 3 : 0,
                      height: "100%",
                      borderRadius: 999,
                      background: isMeta ? "var(--accent)" : "var(--ink-4)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <div style={cellLabel}>Meta check</div>
        <div style={{ font: "650 22px var(--font-ui)", marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
          {int(asc.metaClaimed)} claimed · {int(asc.fromMetaApps)} from Meta apps
        </div>
        <p style={{ ...body, marginBottom: 10 }}>
          Apple counted {int(asc.fromMetaApps)} first-time downloads referred by the Facebook and Instagram apps; Meta claims {int(asc.metaClaimed)} iOS installs over the
          same days{asc.claimRatio != null ? ` (${pct(asc.claimRatio, 0)} of them)` : ""}.
        </p>
        <p style={muted}>
          Apple&rsquo;s count covers every user, not only opted-in devices, and it can&rsquo;t be inflated by Meta&rsquo;s modelling. It includes organic shares and profile
          links, so it&rsquo;s a ceiling for paid Meta installs: if Meta ever claims more than this, its count is padded. Downloads from search and browse are mostly
          people who saw an ad and searched later, which no MMP can tie to a campaign.
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

const TODO: ParityStatus[] = ["idle", "broken", "missing"];

function Parity({ rows }: { rows: ParityRow[] }) {
  const [filter, setFilter] = React.useState<"all" | "todo">("all");
  const isMobile = useIsMobile(900);
  const todo = rows.filter((r) => TODO.includes(r.status));
  const shown = filter === "todo" ? todo : rows;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <Segmented
          size="sm"
          value={filter}
          onChange={(v) => setFilter(v as "all" | "todo")}
          options={[
            { value: "all", label: `All ${rows.length}` },
            { value: "todo", label: `To build or fix ${todo.length}` },
          ]}
        />
        <span style={muted}>Statuses are computed from live data each time the page loads. Counts cover the last 35 days.</span>
      </div>

      {AREAS.map((area) => {
        const inArea = shown.filter((r) => r.area === area);
        if (!inArea.length) return null;
        return (
          <React.Fragment key={area}>
            <SectionHeader family="neutral" icon="Grid" title={area} meta={`${inArea.length} module${inArea.length === 1 ? "" : "s"}`} />
            <Card pad={0}>
              {inArea.map((r, i) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "minmax(170px, 0.9fr) minmax(0, 1.5fr) minmax(0, 1.5fr) minmax(0, 1.5fr)",
                    gap: isMobile ? 10 : 20,
                    padding: "16px 20px",
                    borderTop: i ? "1px solid var(--line)" : "none",
                  }}
                >
                  <div>
                    <div style={{ font: "650 13.5px/1.35 var(--font-ui)", marginBottom: 8 }}>{r.name}</div>
                    <StatusPill kind={PILL[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
                  </div>
                  <div>
                    <div style={cellLabel}>AppsFlyer</div>
                    <p style={muted}>{r.appsflyer}</p>
                  </div>
                  <div>
                    <div style={cellLabel}>The DAD</div>
                    <p style={body}>{r.ours}</p>
                  </div>
                  <div>
                    <div style={cellLabel}>Live evidence</div>
                    <p style={body}>{r.evidence}</p>
                    {r.next && (
                      <p style={{ ...muted, marginTop: 8 }}>
                        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>Next:</strong> {r.next}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </React.Fragment>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// How AppsFlyer works
// ---------------------------------------------------------------------------

function HowItWorks() {
  const isMobile = useIsMobile(900);
  return (
    <>
      <InfoWell style={{ marginBottom: 16 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>From AppsFlyer&rsquo;s public documentation, product and pricing pages, read Nov 5, 2026.</strong> Its terms of use bar
        reverse engineering its code, so nothing here comes from inside the SDK. The rules below are enough to copy the behavior.
      </InfoWell>
      <Card pad={0}>
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.7fr) minmax(0, 1.5fr) minmax(0, 1.5fr)", gap: 20, padding: "12px 20px" }}>
            {["Rule", "AppsFlyer", "The DAD today"].map((h) => (
              <div key={h} style={{ ...cellLabel, marginBottom: 0 }}>
                {h}
              </div>
            ))}
          </div>
        )}
        {MECHANICS.map((m, i) => (
          <div
            key={m.topic}
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(150px, 0.7fr) minmax(0, 1.5fr) minmax(0, 1.5fr)",
              gap: isMobile ? 8 : 20,
              padding: "14px 20px",
              borderTop: i || !isMobile ? "1px solid var(--line)" : "none",
            }}
          >
            <div style={{ font: "650 13.5px/1.35 var(--font-ui)" }}>{m.topic}</div>
            <div>
              {isMobile && <div style={cellLabel}>AppsFlyer</div>}
              <p style={muted}>{m.appsflyer}</p>
            </div>
            <div>
              {isMobile && <div style={cellLabel}>The DAD today</div>}
              <p style={body}>{m.ours}</p>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// AGA
// ---------------------------------------------------------------------------

function Aga() {
  return (
    <>
      <InfoWell style={{ marginBottom: 16 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>What speakers at App Growth Annual 2026 said about MMPs.</strong> {AGA_SUMMARY} Paraphrased from the session transcripts
        in the vault.
      </InfoWell>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {AGA_NOTES.map((n) => (
          <Card key={n.who}>
            <div style={{ font: "650 15px var(--font-ui)" }}>{n.who}</div>
            <div style={{ ...muted, marginBottom: 10 }}>{n.session}</div>
            <ul style={{ margin: "0 0 12px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {n.said.map((line) => (
                <li key={line} style={body}>
                  {line}
                </li>
              ))}
            </ul>
            <div style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 10 }}>
              <div style={cellLabel}>For DreamMe</div>
              <p style={body}>{n.means}</p>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function Plan() {
  return (
    <>
      <InfoWell style={{ marginBottom: 16 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>The steps to match AppsFlyer in-house, in order of what each adds for the work it takes.</strong> None is built by this
        page. The Parity view shows which have moved.
      </InfoWell>
      <Card pad={0}>
        {PLAN.map((p, i) => (
          <div key={p.title} style={{ display: "flex", gap: 16, padding: "16px 20px", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <span
              style={{
                flex: "none",
                width: 26,
                height: 26,
                borderRadius: 8,
                background: "var(--bg-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "650 12.5px var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i + 1}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ font: "650 14px var(--font-ui)" }}>{p.title}</span>
                <StatusPill kind="neutral">{p.needs}</StatusPill>
              </div>
              <p style={{ ...body, marginBottom: 4 }}>{p.why}</p>
              <p style={muted}>{p.work}</p>
            </div>
          </div>
        ))}
      </Card>

      <SectionHeader family="attention" icon="Lock" title="What can't be copied" meta="needs ad-network partner status" />
      <Card pad={0}>
        {CANT_COPY.map((c, i) => (
          <div
            key={c.what}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
              padding: "14px 20px",
              borderTop: i ? "1px solid var(--line)" : "none",
            }}
          >
            <div style={{ font: "650 13.5px/1.4 var(--font-ui)" }}>{c.what}</div>
            <div>
              <div style={cellLabel}>What we use instead</div>
              <p style={body}>{c.substitute}</p>
            </div>
          </div>
        ))}
      </Card>
      <InfoWell style={{ marginTop: 16 }}>{BUY_OPTION}</InfoWell>
    </>
  );
}
