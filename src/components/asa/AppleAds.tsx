"use client";

/**
 * Apple Ads tab. Reads /api/asa (the asa_* tables, filled daily by
 * /api/cron/sync-asa); "Sync now" runs the same sync. Read-only toward Apple:
 * nothing here changes a campaign, bid or budget.
 *
 * Order follows what the decision needs: trials and cost per trial first
 * (installs are a means, not the goal), then each campaign's health, the
 * running test's keep/stop read, keywords, and search terms for negatives.
 */

import * as React from "react";
import { PageHeader } from "../Shell";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, InfoWell, SectionHeader, Segmented, StatStrip, StatusPill, thStyle, fam, type Family } from "../porcelain";
import { TrendChart } from "../plan/TrendChart";
import { int, pct, shortDate, tableCard, tdStyle, usd } from "../plan/format";
import { ratios, sumRows, windowStart, type Totals, type Warning } from "@/lib/asa/logic";
import type { AsaPayload } from "@/lib/asa/read";

type Win = "7" | "30" | "90";
type Metric = "spend" | "impressions" | "tap_installs";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const TONE_FAMILY: Record<Warning["tone"], Family> = { danger: "danger", warning: "warning", info: "info", success: "success" };

function WarningLine({ w }: { w: Warning }) {
  const f = fam(TONE_FAMILY[w.tone]);
  const Icon = w.tone === "danger" ? Icons.Octagon : w.tone === "warning" ? Icons.TriAlert : w.tone === "success" ? Icons.Check : Icons.InfoCircle;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", font: "400 13px/1.45 var(--font-ui)", color: w.tone === "info" ? "var(--ink-2)" : f.text }}>
      <span style={{ color: f.solid, flex: "none", marginTop: 1 }}>
        <Icon size={15} />
      </span>
      <span>{w.text}</span>
    </div>
  );
}

function statusOf(c: AsaPayload["campaigns"][number]): { kind: "running" | "neutral" | "attention" | "danger"; label: string } {
  if (c.status === "PAUSED") return { kind: "neutral", label: "PAUSED" };
  if (c.serving_status === "RUNNING") return { kind: "running", label: "RUNNING" };
  if (c.display_status === "ON_HOLD") return { kind: "neutral", label: "ON HOLD" };
  return { kind: "attention", label: "ON, NOT SERVING" };
}

const Num = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => (
  <span style={{ fontVariantNumeric: "tabular-nums", color: muted ? "var(--ink-3)" : undefined }}>{children}</span>
);

export function AppleAds() {
  const [data, setData] = React.useState<AsaPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [win, setWin] = React.useState<Win>("30");
  const [metric, setMetric] = React.useState<Metric>("spend");
  const [campaignFilter, setCampaignFilter] = React.useState<string>("all");
  const toast = useToast();

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/asa", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as AsaPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/asa", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast(body.ok ? `Synced ${body.campaigns} campaigns, ${body.keywords} keywords` : `Synced with errors: ${(body.errors ?? []).join("; ").slice(0, 160)}`);
      await load();
    } catch (e) {
      toast(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const header = (
    <PageHeader
      title="Apple Ads"
      subtitle={data ? `Synced ${ago(data.synced_at)} · days in New York time · read-only` : "Search ads on the App Store"}
      actions={
        <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={sync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      }
    />
  );

  if (error) return <div>{header}<ErrorBanner>Couldn&apos;t load Apple Ads: {error}</ErrorBanner></div>;
  if (!data) return <div>{header}<Skeleton /></div>;

  if (data.campaigns.length === 0) {
    return (
      <div>
        {header}
        <Card>
          <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>No Apple Ads data yet</div>
          <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--ink-2)", maxWidth: 640 }}>
            {data.configured
              ? "The keys are set. Press Sync now to pull campaigns and the last 14 days; the daily sync runs at 6 AM New York time."
              : "The server doesn't have the Apple Ads keys yet (ASA_CLIENT_ID, ASA_TEAM_ID, ASA_KEY_ID, ASA_ORG_ID, ASA_PRIVATE_KEY in Vercel). Once they're added, Sync now pulls everything."}
          </div>
        </Card>
      </div>
    );
  }

  // Today is still filling in, so every window ends on yesterday.
  const end = windowStart(data.today, 2);
  const days = Number(win);
  const from = windowStart(end, days);
  const prevFrom = windowStart(from, days + 1);
  const inWin = data.daily.filter((d) => d.day >= from && d.day <= end);
  const prevWin = data.daily.filter((d) => d.day >= prevFrom && d.day < from);
  const tot = sumRows(inWin);
  const prev = sumRows(prevWin);
  const r = ratios(tot);
  const trialsInWin = data.attribution.trial_days.filter((t) => t.day >= from && t.day <= end).length;
  const proven = data.attribution.proven;

  const delta = (a: number, b: number): { text: string; family: Family } | null => {
    if (!b) return null;
    const ch = (a - b) / b;
    return { text: `${ch >= 0 ? "+" : "−"}${Math.abs(ch * 100).toFixed(0)}%`, family: "neutral" };
  };
  const dSpend = delta(tot.spend, prev.spend);
  const dInst = delta(tot.tap_installs, prev.tap_installs);

  return (
    <div>
      {header}

      {!proven && (
        <InfoWell style={{ marginBottom: 16, color: "var(--ink-2)" }}>
          <strong style={{ color: "var(--ink)" }}>Trials aren&apos;t counted yet.</strong> The app sends Apple&apos;s attribution token from iOS 1.5.8. Trials show here, by campaign and keyword, once RevenueCat tags its first Apple Ads user. Until then, judge on tap installs, not trials.
        </InfoWell>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Segmented
          size="sm"
          value={win}
          onChange={(v) => setWin(v as Win)}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
      </div>

      <StatStrip
        minColWidth={140}
        stats={[
          { label: "Spend", value: usd(tot.spend), delta: dSpend?.text, deltaFamily: dSpend?.family, note: dSpend ? `vs prior ${days} days` : undefined },
          { label: "Trials", value: proven ? int(trialsInWin) : "—", note: proven ? (trialsInWin ? `${usd(tot.spend / trialsInWin)} per trial` : "none yet") : "not measured yet" },
          { label: "Tap installs", value: int(tot.tap_installs), delta: dInst?.text, deltaFamily: dInst?.family, note: r.cost_per_tap_install != null ? `${usd(r.cost_per_tap_install)} each` : undefined },
          { label: "Taps", value: int(tot.taps), note: r.avg_cpt != null ? `${usd(r.avg_cpt)} avg per tap` : undefined },
          { label: "Impressions", value: int(tot.impressions), note: r.tap_rate != null ? `${pct(r.tap_rate)} tapped` : undefined },
        ]}
      />
      <div style={{ font: "400 12px/1.5 var(--font-ui)", color: "var(--ink-3)", margin: "8px 2px 0" }}>
        Apple also counts {int(tot.view_installs)} view-through installs: people who saw the ad and installed without tapping it. Most would have installed anyway, so they&apos;re left out of cost per install.
      </div>

      <SectionHeader family="accent" icon="Trend" title="Day by day" meta={`last ${days} days, all campaigns`} />
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, margin: "-2px 0 10px" }}>
        <Segmented
          size="sm"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={[
            { value: "spend", label: "Spend" },
            { value: "impressions", label: "Impressions" },
            { value: "tap_installs", label: "Tap installs" },
          ]}
        />
      </div>
      <Card>
        <TrendChart
          ariaLabel={`Apple Ads ${metric} per day`}
          color="var(--accent)"
          format={(v) => (metric === "spend" ? usd(v, 0) : int(v))}
          points={dailySeries(data, from, end, metric)}
        />
      </Card>

      {data.tests.length > 0 && (
        <>
          <SectionHeader family="attention" icon="Flask" title="Tests" meta="keep or stop on cost per trial" />
          <div style={{ display: "grid", gap: 12 }}>
            {data.tests.map((t) => (
              <TestCard key={t.campaign_id} t={t} data={data} />
            ))}
          </div>
        </>
      )}

      <SectionHeader family="info" icon="Grid" title="Campaigns" meta={`last ${days} days`} />
      <div style={{ display: "grid", gap: 12 }}>
        {data.campaigns.map((c) => (
          <CampaignCard key={c.campaign_id} c={c} data={data} from={from} end={end} days={days} />
        ))}
      </div>

      <SectionHeader
        family="neutral"
        icon="Search"
        title="Keywords"
        meta={`last ${days} days`} />
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, margin: "-2px 0 10px" }}>
        <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            aria-label="Campaign"
            style={{ font: "500 13px var(--font-ui)", padding: "6px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
          >
            <option value="all">All campaigns</option>
            {data.campaigns.map((c) => (
              <option key={c.campaign_id} value={String(c.campaign_id)}>
                {c.name}
              </option>
            ))}
          </select>
      </div>
      <KeywordTable data={data} from={from} end={end} campaign={campaignFilter} />

      <SectionHeader family="neutral" icon="Message" title="What people searched" meta={searchWindowLabel(data)} />
      <SearchTerms data={data} campaign={campaignFilter} />
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: "grid", gap: 12 }} aria-busy="true">
      {[88, 200, 140].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 16, background: "var(--bg-2)" }} />
      ))}
    </div>
  );
}

function dailySeries(data: AsaPayload, from: string, end: string, metric: Metric) {
  const byDay = new Map<string, number>();
  for (const d of data.daily) if (d.day >= from && d.day <= end) byDay.set(d.day, (byDay.get(d.day) ?? 0) + Number(d[metric]));
  const out = [];
  for (let day = from; day <= end; ) {
    out.push({ x: day, y: byDay.get(day) ?? 0 });
    const n = new Date(`${day}T00:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    day = n.toISOString().slice(0, 10);
  }
  return out;
}

function CampaignCard({ c, data, from, end, days }: { c: AsaPayload["campaigns"][number]; data: AsaPayload; from: string; end: string; days: number }) {
  const t: Totals = sumRows(data.daily.filter((d) => d.campaign_id === c.campaign_id && d.day >= from && d.day <= end));
  const r = ratios(t);
  const st = statusOf(c);
  const trials = data.attribution.proven
    ? data.attribution.trial_days.filter((d) => d.campaign_id === c.campaign_id && d.day >= from && d.day <= end).length
    : null;
  const groups = data.ad_groups.filter((g) => g.campaign_id === c.campaign_id);
  const cells: [string, string][] = [
    ["Spend", usd(t.spend)],
    ["Trials", trials == null ? "—" : int(trials)],
    ["Cost per trial", trials ? usd(t.spend / trials) : "—"],
    ["Tap installs", int(t.tap_installs)],
    ["Avg per tap", usd(r.avg_cpt)],
    ["Tapped", pct(r.tap_rate)],
  ];
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ font: "650 15px var(--font-ui)", color: "var(--ink)" }}>{c.name}</div>
        <StatusPill kind={st.kind}>{st.label}</StatusPill>
        <span style={{ flex: 1 }} />
        <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {c.daily_budget != null ? `${usd(c.daily_budget, 0)}/day` : "no daily cap"} · {c.countries.join(", ")}
          {c.end_time ? ` · ends ${shortDate(c.end_time.slice(0, 10))}` : ""}
        </span>
      </div>
      {t.impressions === 0 && t.spend === 0 ? (
        <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)", marginTop: 10 }}>No impressions in the last {days} days.</div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px 18px", marginTop: 14 }}>
        {cells.map(([k, v]) => (
          <div key={k}>
            <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{k}</div>
            <div style={{ font: "650 17px var(--font-ui)", fontVariantNumeric: "tabular-nums", color: "var(--ink)", marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>
      )}
      {c.warnings.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
          {c.warnings.map((w, i) => (
            <WarningLine key={i} w={w} />
          ))}
        </div>
      )}
      {groups.length > 1 && (
        <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 12 }}>
          Ad groups: {groups.map((g) => `${g.name} (${g.status === "PAUSED" ? "paused" : `default bid ${usd(g.default_bid)}`})`).join(" · ")}
        </div>
      )}
    </Card>
  );
}

function TestCard({ t, data }: { t: AsaPayload["tests"][number]; data: AsaPayload }) {
  const c = data.campaigns.find((x) => x.campaign_id === t.campaign_id);
  const rd = t.read;
  const kw = data.keywords.filter((k) => k.campaign_id === t.campaign_id);
  const since = rd.started_on ?? data.today;
  const kwImp = new Map<number, number>();
  for (const d of data.keyword_daily) if (d.campaign_id === t.campaign_id && d.day >= since) kwImp.set(d.keyword_id, (kwImp.get(d.keyword_id) ?? 0) + d.impressions);
  const silent = kw.filter((k) => !kwImp.get(k.keyword_id));
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ font: "650 15px var(--font-ui)" }}>{t.label}</div>
        <StatusPill kind={rd.state === "running" ? "running" : rd.state === "ended" ? "success" : "neutral"}>
          {rd.state === "running" ? `DAY ${rd.day} OF ${t.length_days}` : rd.state === "ended" ? "ENDED" : "NOT STARTED"}
        </StatusPill>
        <span style={{ flex: 1 }} />
        <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>
          Keep at {usd(t.keep_cost_per_trial, 0)} or less per trial · stop above {usd(t.stop_cost_per_trial, 0)}
        </span>
      </div>
      <WarningLine w={rd.verdict} />
      {rd.state !== "not_started" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px 18px", marginTop: 14 }}>
          {[
            ["Spent", usd(rd.spend)],
            ["Budget to date", usd(rd.budget_to_date)],
            ["Pace", pct(rd.pace, 0)],
            ["Trials", rd.trials == null ? "—" : int(rd.trials)],
            ["Cost per trial", usd(rd.cost_per_trial)],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{k}</div>
              <div style={{ font: "650 17px var(--font-ui)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-2)", marginTop: 12 }}>
        {rd.state === "not_started"
          ? `${kw.length} keywords ready, campaign ${c?.status === "PAUSED" ? "paused" : "on"}. Checkpoints: ${t.checkpoints.map((n) => `day ${n}`).join(", ")}.`
          : silent.length
            ? `${silent.length} of ${kw.length} keywords have had no impressions since the start: ${silent.slice(0, 6).map((k) => k.keyword).join(", ")}${silent.length > 6 ? "…" : ""}. A bid may be too low.`
            : `Every keyword has served since the start.`}
        {t.notes ? ` ${t.notes}` : ""}
      </div>
      <div style={{ font: "400 12px/1.5 var(--font-ui)", color: "var(--ink-3)", marginTop: 8 }}>
        Trials here come from the attribution RevenueCat attaches to each trial start. Until this count has matched RevenueCat&apos;s own Apple Search Ads chart once, decide keep or stop from that chart.
      </div>
    </Card>
  );
}

function KeywordTable({ data, from, end, campaign }: { data: AsaPayload; from: string; end: string; campaign: string }) {
  const [showIdle, setShowIdle] = React.useState(false);
  const byKw = new Map<number, Totals>();
  for (const d of data.keyword_daily) {
    if (d.day < from || d.day > end) continue;
    const t = byKw.get(d.keyword_id) ?? { impressions: 0, taps: 0, tap_installs: 0, view_installs: 0, spend: 0 };
    t.impressions += d.impressions;
    t.taps += d.taps;
    t.tap_installs += d.tap_installs;
    t.view_installs += d.view_installs;
    t.spend += d.spend;
    byKw.set(d.keyword_id, t);
  }
  const groupName = new Map(data.ad_groups.map((g) => [g.ad_group_id, g.name]));
  const rows = data.keywords
    .filter((k) => campaign === "all" || String(k.campaign_id) === campaign)
    .map((k) => {
      const t = byKw.get(k.keyword_id) ?? { impressions: 0, taps: 0, tap_installs: 0, view_installs: 0, spend: 0 };
      const trials = data.attribution.trials_by_keyword[`${k.campaign_id}|${k.keyword.toLowerCase()}`] ?? 0;
      return { k, t, r: ratios(t), trials };
    })
    .sort((a, b) => b.t.impressions - a.t.impressions || b.t.spend - a.t.spend || a.k.keyword.localeCompare(b.k.keyword));
  const proven = data.attribution.proven;
  const idle = rows.filter((x) => x.t.impressions === 0);
  const shown = showIdle ? rows : rows.filter((x) => x.t.impressions > 0);
  return (
    <Card pad={0} style={tableCard}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Keyword</th>
            <th style={thStyle()}>Bid</th>
            <th style={thStyle()}>Impr.</th>
            <th style={thStyle()}>Taps</th>
            <th style={thStyle()}>Avg tap</th>
            <th style={thStyle()}>Tap installs</th>
            <th style={thStyle()}>Spend</th>
            <th style={thStyle()}>Trials</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ k, t, r, trials }) => (
            <tr key={k.keyword_id} style={{ opacity: k.status === "PAUSED" ? 0.62 : 1 }}>
              <td style={{ ...tdStyle("left"), minWidth: 190 }}>
                <div style={{ color: "var(--ink)" }}>{k.keyword}</div>
                <div style={{ font: "400 11.5px var(--font-ui)", color: "var(--ink-3)" }}>
                  {k.match_type === "EXACT" ? "Exact" : "Broad"}
                  {k.status === "PAUSED" ? " · paused" : ""} · {groupName.get(k.ad_group_id) ?? ""}
                </div>
              </td>
              <td style={tdStyle()}>{usd(k.bid)}</td>
              <td style={tdStyle()}><Num muted={!t.impressions}>{int(t.impressions)}</Num></td>
              <td style={tdStyle()}>{int(t.taps)}</td>
              <td style={tdStyle()}>{usd(r.avg_cpt)}</td>
              <td style={tdStyle()}>{int(t.tap_installs)}</td>
              <td style={tdStyle()}>{usd(t.spend)}</td>
              <td style={tdStyle()}>{proven ? int(trials) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...tdStyle("left"), color: "var(--ink-3)" }}>No keywords in this campaign.</td>
            </tr>
          )}
        </tbody>
      </table>
      {idle.length > 0 && (
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
          <Button size="sm" variant="ghost" onClick={() => setShowIdle((v) => !v)}>
            {showIdle ? "Hide keywords with no impressions" : `Show ${idle.length} keywords with no impressions`}
          </Button>
        </div>
      )}
    </Card>
  );
}

function searchWindowLabel(data: AsaPayload) {
  const s = data.search_terms[0];
  return s ? `${shortDate(s.window_start)} to ${shortDate(s.window_end)}` : "last 30 days";
}

function SearchTerms({ data, campaign }: { data: AsaPayload; campaign: string }) {
  const rows = data.search_terms.filter((s) => campaign === "all" || String(s.campaign_id) === campaign);
  const totalImp = rows.reduce((a, s) => a + s.impressions, 0);
  const hiddenImp = rows.filter((s) => !s.search_term).reduce((a, s) => a + s.impressions, 0);
  const visible = rows.filter((s) => s.search_term);
  const negatives = data.negatives.filter((n) => campaign === "all" || String(n.campaign_id) === campaign).length;
  return (
    <Card pad={0} style={tableCard}>
      <div style={{ padding: "14px 16px 6px", font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)" }}>
        {totalImp
          ? `Apple hides ${pct(hiddenImp / totalImp, 0)} of impressions behind low-volume searches. Look below for searches that don't fit and add them as negatives (${negatives} set now).`
          : "No search terms in this window."}
      </div>
      {visible.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>Search</th>
              <th style={thStyle("left")}>Matched keyword</th>
              <th style={thStyle()}>Impr.</th>
              <th style={thStyle()}>Taps</th>
              <th style={thStyle()}>Tap installs</th>
              <th style={thStyle()}>Spend</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 40).map((s, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle("left"), color: "var(--ink)" }}>{s.search_term}</td>
                <td style={{ ...tdStyle("left"), color: "var(--ink-2)" }}>
                  {s.keyword ?? "—"}
                  {s.source === "AUTO" ? " (Search Match)" : ""}
                </td>
                <td style={tdStyle()}>{int(s.impressions)}</td>
                <td style={tdStyle()}>{int(s.taps)}</td>
                <td style={tdStyle()}>{int(s.tap_installs)}</td>
                <td style={tdStyle()}>{usd(s.spend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
