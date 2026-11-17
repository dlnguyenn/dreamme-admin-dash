"use client";

/**
 * App Store listing (ASO) tab. Reads /api/aso: App Store Connect search
 * funnel (aso_store_daily), daily search ranks against MeAgain and Shotsy
 * (aso_rank_checks), rating counts (app_store_rating_snapshots) and the
 * "ASO n" items of the April Plan todo list, which can be ticked here.
 */

import * as React from "react";
import { PageHeader } from "../Shell";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, InfoWell, SectionHeader, Segmented, StatStrip, thStyle, fam, type Family } from "../porcelain";
import { TrendChart } from "../plan/TrendChart";
import { int, pct, shortDate, tableCard, tdStyle } from "../plan/format";
import { windowStart } from "@/lib/asa/logic";
import { BASELINE_DAY, rankGain, type LocaleVerdict, type StoreDailyRow, type TermView } from "@/lib/aso/logic";
import type { AsoPayload } from "@/lib/aso/read";

type Terr = "US" | "ALL";
type Win = "28" | "90";
type Metric = "first_downloads" | "impressions_unique" | "conversion";
type TermSet = "core" | "locale-test" | "br";

const SEARCH = "App Store search";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const utcToday = () => new Date().toISOString().slice(0, 10);

interface Funnel {
  impressions: number;
  page_views: number;
  downloads: number;
  all_downloads: number;
  /** Search downloads on days that also have impressions (for conversion). */
  downloads_matched: number;
  imp_days: number;
  dl_days: number;
}
/**
 * Search funnel for a window. Apple's downloads report goes back further than
 * the impressions report (~35 days), so each metric counts its own days, and
 * conversion uses only days that have both. A day with 0 search impressions
 * means "no data" at our volume, not a real zero.
 */
function funnel(rows: StoreDailyRow[], terr: Terr, from: string, to: string): Funnel {
  const f: Funnel = { impressions: 0, page_views: 0, downloads: 0, all_downloads: 0, downloads_matched: 0, imp_days: 0, dl_days: 0 };
  for (const r of rows) {
    if (r.territory !== terr || r.day < from || r.day > to) continue;
    f.all_downloads += r.first_downloads;
    if (r.source_type !== SEARCH) continue;
    f.downloads += r.first_downloads;
    if (r.first_downloads > 0) f.dl_days++;
    if (r.impressions_unique > 0) {
      f.imp_days++;
      f.impressions += r.impressions_unique;
      f.page_views += r.page_views_unique;
      f.downloads_matched += r.first_downloads;
    }
  }
  return f;
}

function change(a: number | null, b: number | null): { text: string; family: Family } | undefined {
  if (a == null || b == null || !b) return undefined;
  const ch = (a - b) / b;
  return { text: `${ch >= 0 ? "+" : "−"}${Math.abs(ch * 100).toFixed(0)}%`, family: ch >= 0 ? "success" : "danger" };
}

const VERDICT: Record<LocaleVerdict, { label: string; family: Family }> = {
  keep: { label: "Keep, so far", family: "success" },
  watch: { label: "Watch", family: "warning" },
  drop: { label: "Drop, so far", family: "danger" },
  "no data": { label: "No check yet", family: "neutral" },
};

export function AsoTab() {
  const [data, setData] = React.useState<AsoPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [terr, setTerr] = React.useState<Terr>("US");
  const [win, setWin] = React.useState<Win>("28");
  const [metric, setMetric] = React.useState<Metric>("first_downloads");
  const [termSet, setTermSet] = React.useState<TermSet>("core");
  const toast = useToast();

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/aso", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as AsoPayload);
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
      const res = await fetch("/api/aso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "store" }) });
      const body = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast(body.ok ? `Pulled App Store Connect: ${body.days?.length ?? 0} days` : `Pulled with errors: ${(body.errors ?? []).join("; ").slice(0, 160)}`);
      await load();
    } catch (e) {
      toast(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const toggleTodo = async (id: string, done: boolean) => {
    setData((d) => (d ? { ...d, todos: d.todos.map((t) => (t.id === id ? { ...t, done } : t)) } : d));
    const res = await fetch(`/api/plan/todos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done }) });
    if (!res.ok) {
      toast("Couldn't save that tick");
      load();
    }
  };

  const header = (
    <PageHeader
      title="App Store listing"
      subtitle={data ? `Search data synced ${ago(data.store_synced_at)} · ranks checked ${data.ranks_last_day ? shortDate(data.ranks_last_day) : "never"}` : "Search, ranks, ratings and the ASO plan"}
      actions={
        <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={sync} disabled={syncing}>
          {syncing ? "Pulling…" : "Pull App Store data"}
        </Button>
      }
    />
  );

  if (error) return <div>{header}<ErrorBanner>Couldn&apos;t load the App Store data: {error}</ErrorBanner></div>;
  if (!data) return <div>{header}<div style={{ height: 320, borderRadius: 16, background: "var(--bg-2)" }} aria-busy="true" /></div>;

  // App Store Connect lags ~2 days, and downloads land a day before
  // impressions; end the window on the newest day that has both.
  const lastWith = (k: "impressions_unique" | "first_downloads") =>
    data.store_daily.filter((r) => r.source_type === SEARCH && r[k] > 0).map((r) => r.day).sort().at(-1);
  const li = lastWith("impressions_unique");
  const ld = lastWith("first_downloads");
  const lastDay = (li && ld ? (li < ld ? li : ld) : li ?? ld) ?? utcToday();
  const days = Number(win);
  const from = windowStart(lastDay, days);
  const prevTo = windowStart(from, 2);
  const prevFrom = windowStart(prevTo, days);
  const cur = funnel(data.store_daily, terr, from, lastDay);
  const prv = funnel(data.store_daily, terr, prevFrom, prevTo);
  const conv = cur.impressions ? cur.downloads_matched / cur.impressions : null;
  const convPrev = prv.impressions ? prv.downloads_matched / prv.impressions : null;
  const share = cur.all_downloads ? cur.downloads / cur.all_downloads : null;
  const haveStore = data.store_daily.length > 0;
  // Compare only when both windows have (nearly) every day of that metric.
  const full = (n: number) => n >= days - 2;
  const dlComparable = full(cur.dl_days) && full(prv.dl_days);
  const impComparable = full(cur.imp_days) && full(prv.imp_days);
  const firstImpDay = data.store_daily.filter((r) => r.source_type === SEARCH && r.impressions_unique > 0).map((r) => r.day).sort()[0];
  // First day of the unbroken run of download data ending at lastDay (older stray rows don't count).
  const dlDays = [...new Set(data.store_daily.filter((r) => r.territory === terr && r.source_type === SEARCH && r.first_downloads > 0).map((r) => r.day))].sort();
  let firstDlDay = dlDays.at(-1);
  for (let i = dlDays.length - 1; i > 0 && windowStart(dlDays[i], 2) <= dlDays[i - 1]; i--) firstDlDay = dlDays[i - 1];

  const markers = data.markers.filter((m) => m.day >= from);

  return (
    <div>
      {header}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Segmented size="sm" value={terr} onChange={(v) => setTerr(v as Terr)} options={[{ value: "US", label: "US" }, { value: "ALL", label: "All countries" }]} />
        <Segmented size="sm" value={win} onChange={(v) => setWin(v as Win)} options={[{ value: "28", label: "4 weeks" }, { value: "90", label: "90 days" }]} />
      </div>

      {!haveStore ? (
        <Card>
          <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>No App Store search data yet</div>
          <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--ink-2)", maxWidth: 640 }}>
            Press Pull App Store data to load the last ~35 days from App Store Connect. After that it updates every morning. Apple deletes daily files after about 35 days, so this table becomes the only long history.
          </div>
        </Card>
      ) : (
        <>
          <StatStrip
            minColWidth={140}
            stats={[
              { label: "Search downloads", value: int(cur.downloads), delta: dlComparable ? change(cur.downloads, prv.downloads)?.text : undefined, deltaFamily: change(cur.downloads, prv.downloads)?.family, note: full(cur.dl_days) ? "first-time" : `since ${firstDlDay ? shortDate(firstDlDay) : "—"}` },
              { label: "Search conversion", value: pct(conv), delta: impComparable && conv != null && convPrev != null ? `${conv >= convPrev ? "+" : "−"}${Math.abs((conv - convPrev) * 100).toFixed(1)} pts` : undefined, deltaFamily: conv != null && convPrev != null ? (conv >= convPrev ? "success" : "danger") : undefined, note: impComparable ? undefined : "downloads per viewer" },
              { label: "Saw us in search", value: int(cur.impressions), delta: impComparable ? change(cur.impressions, prv.impressions)?.text : undefined, deltaFamily: change(cur.impressions, prv.impressions)?.family, note: full(cur.imp_days) ? "people, daily" : `since ${firstImpDay ? shortDate(firstImpDay) : "—"}` },
              { label: "Opened the page", value: int(cur.page_views), note: cur.impressions ? `${pct(cur.page_views / cur.impressions)} of them` : undefined },
              { label: "Search share", value: pct(share, 0), note: full(cur.dl_days) ? "of all first-time downloads" : `of downloads since ${firstDlDay ? shortDate(firstDlDay) : "—"}` },
            ]}
          />
          <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", margin: "8px 2px 0" }}>
            {shortDate(from)} to {shortDate(lastDay)} vs the {days} days before. Apple posts days ~2 days late and keeps impressions ~35 days; this tab keeps them from now on. Viewers are summed per day, ~4% above App Analytics.
          </div>

          <SectionHeader
            family="accent"
            icon="Trend"
            title="Search, day by day"
            meta={markers.length ? "shaded: releases and listing changes" : undefined} />
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, margin: "-2px 0 10px" }}>
        <Segmented
                size="sm"
                value={metric}
                onChange={(v) => setMetric(v as Metric)}
                options={[
                  { value: "first_downloads", label: "Downloads" },
                  { value: "impressions_unique", label: "Impressions" },
                  { value: "conversion", label: "Conversion" },
                ]}
              />
      </div>
          <Card>
            <TrendChart
              ariaLabel={`App Store search ${metric} per day`}
              color="var(--accent)"
              format={(v) => (metric === "conversion" ? pct(v, 0) : int(v))}
              points={searchSeries(data.store_daily, terr, firstDlDay && firstDlDay > from ? firstDlDay : from, lastDay, metric, from)}
              shade={groupMarkers(markers)}
            />
          </Card>
        </>
      )}

      <SectionHeader
        family="info"
        icon="Search"
        title="Where we rank"
        meta={`vs the ${shortDate(BASELINE_DAY)} baseline`} />
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, margin: "-2px 0 10px" }}>
        <Segmented
            size="sm"
            value={termSet}
            onChange={(v) => setTermSet(v as TermSet)}
            options={[
              { value: "core", label: "Core terms" },
              { value: "locale-test", label: "Hidden locales" },
              { value: "br", label: "Brazil" },
            ]}
          />
      </div>
      {termSet === "locale-test" && <LocaleVerdicts data={data} />}
      <RankTable terms={data.terms.filter((t) => t.term_sets.includes(termSet))} />
      <div style={{ font: "400 12px/1.5 var(--font-ui)", color: "var(--ink-3)", margin: "8px 2px 0" }}>
        Ranks come from Apple&apos;s public search API: close to the real order, without the ad slot or personalization, so a few places of daily movement is noise.
      </div>

      <SectionHeader family="attention" icon="Star" title="Ratings" meta="US" />
      <Ratings data={data} />

      <SectionHeader family="success" icon="Check" title="ASO plan" meta={`${data.todos.filter((t) => t.done).length} of ${data.todos.length} done · same list as April Plan`} />
      <Card pad="6px 0">
        {data.todos.map((t) => (
          <label key={t.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 18px", cursor: "pointer" }}>
            <input type="checkbox" checked={t.done} onChange={(e) => toggleTodo(t.id, e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--accent)" }} />
            <span>
              <span style={{ font: "500 13.5px var(--font-ui)", color: t.done ? "var(--ink-3)" : "var(--ink)", textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
              {t.note && <span style={{ display: "block", font: "400 12.5px/1.45 var(--font-ui)", color: "var(--ink-3)", marginTop: 2 }}>{t.note}</span>}
            </span>
          </label>
        ))}
        {data.todos.length === 0 && <div style={{ padding: "10px 18px", font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>No ASO items on the April Plan list.</div>}
      </Card>
    </div>
  );
}

/** Markers a few days apart share one shaded band, so their labels don't collide. */
function groupMarkers(markers: { day: string; label: string }[]) {
  const out: { from: string; to: string; first: string; last: string; n: number }[] = [];
  for (const m of markers) {
    const g = out.at(-1);
    if (g && windowStart(m.day, 5) <= g.to) {
      g.to = m.day;
      g.last = m.label.split(" ")[0];
      g.n++;
    } else out.push({ from: m.day, to: m.day, first: m.label, last: m.label, n: 1 });
  }
  return out.map((g) => ({ from: g.from, to: g.to, label: g.n === 1 ? g.first : `${g.first.split(" ")[0]} – ${g.last}` }));
}

/** Days before `dataFrom` (where Apple's unbroken data starts) are gaps, not zeros. */
function searchSeries(rows: StoreDailyRow[], terr: Terr, dataFrom: string, to: string, metric: Metric, from: string = dataFrom) {
  const by = new Map<string, { imp: number; dl: number }>();
  for (const r of rows) {
    if (r.territory !== terr || r.source_type !== SEARCH || r.day < from || r.day > to) continue;
    by.set(r.day, { imp: r.impressions_unique, dl: r.first_downloads });
  }
  const out: { x: string; y: number | null; note?: string }[] = [];
  for (let d = from; d <= to; ) {
    const v = d < dataFrom ? undefined : by.get(d);
    const y = !v ? null : metric === "first_downloads" ? v.dl : !v.imp ? null : metric === "impressions_unique" ? v.imp : v.dl / v.imp;
    out.push({ x: d, y, note: v ? `${int(v.dl)} downloads from ${int(v.imp)} impressions` : undefined });
    const n = new Date(`${d}T00:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
  return out;
}

function RankCell({ rank, n }: { rank: number | null | undefined; n?: number | null }) {
  if (rank === undefined) return <span style={{ color: "var(--ink-4)" }}>—</span>;
  if (rank == null) return <span style={{ color: "var(--ink-3)" }}>{n != null && n < 190 ? `not in ${n}` : "200+"}</span>;
  return <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: rank <= 3 ? 650 : 400 }}>{rank}</span>;
}

function Gain({ g }: { g: number | null }) {
  if (g == null || g === 0) return <span style={{ color: "var(--ink-4)" }}>{g === 0 ? "same" : "—"}</span>;
  const f = fam(g > 0 ? "success" : "danger");
  return <span style={{ color: f.text, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{g > 0 ? `up ${g}` : `down ${-g}`}</span>;
}

function RankTable({ terms }: { terms: TermView[] }) {
  if (terms.length === 0) {
    return (
      <Card>
        <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>No terms tracked in this set yet.</div>
      </Card>
    );
  }
  return (
    <Card pad={0} style={tableCard}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Search</th>
            <th style={thStyle()}>DreamMe</th>
            <th style={thStyle()}>Since baseline</th>
            <th style={thStyle()}>This week</th>
            <th style={thStyle()}>MeAgain</th>
            <th style={thStyle()}>Shotsy</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((t) => {
            const now = t.latest;
            const sameAsBase = now && t.baseline && now.day === t.baseline.day;
            return (
              <tr key={`${t.country}|${t.term}`}>
                <td style={{ ...tdStyle("left"), minWidth: 170 }}>
                  <span style={{ color: "var(--ink)" }}>{t.term}</span>
                  {t.locale_tag && <span style={{ color: "var(--ink-3)", font: "400 11.5px var(--font-ui)" }}> · {t.locale_tag}</span>}
                </td>
                <td style={tdStyle()}><RankCell rank={now ? now.dreamme : undefined} n={now?.results_n} /></td>
                <td style={tdStyle()}>{sameAsBase ? <span style={{ color: "var(--ink-4)" }}>baseline</span> : <Gain g={rankGain(t.baseline?.dreamme, now?.dreamme)} />}</td>
                <td style={tdStyle()}><Gain g={rankGain(t.week_ago?.dreamme, now?.dreamme)} /></td>
                <td style={tdStyle()}><RankCell rank={now ? now.meagain : undefined} n={now?.results_n} /></td>
                <td style={tdStyle()}><RankCell rank={now ? now.shotsy : undefined} n={now?.results_n} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function LocaleVerdicts({ data }: { data: AsoPayload }) {
  if (!data.locales.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
      {data.locales.map((l) => {
        const v = VERDICT[l.verdict];
        const f = fam(v.family);
        return (
          <Card key={l.locale_tag} pad="12px 14px">
            <div style={{ font: "650 13.5px var(--font-ui)" }}>{l.locale_tag}</div>
            <div style={{ font: "650 13px var(--font-ui)", color: f.text, marginTop: 4 }}>{v.label}</div>
            <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 2 }}>
              best rank {l.best ?? "none"} · {l.terms} terms
            </div>
          </Card>
        );
      })}
      <InfoWell style={{ gridColumn: "1 / -1" }}>
        Rule from the plan: keep a hidden locale whose terms reach the top 20; one with nothing in the top 50 goes back to the en-US name in the next version. Read it 4 weeks after 1.5.8 is live.
      </InfoWell>
    </div>
  );
}

function Ratings({ data }: { data: AsoPayload }) {
  const us = data.ratings.filter((r) => r.territory === "us").sort((a, b) => a.day.localeCompare(b.day) || (a.source === "lookup" ? 1 : -1));
  const byDay = new Map<string, number>();
  let avg: number | null = null;
  for (const r of us) {
    byDay.set(r.day, r.rating_count);
    if (r.average_rating != null) avg = r.average_rating;
  }
  const days = [...byDay.keys()].sort();
  const last = days.at(-1);
  if (!last) {
    return (
      <Card>
        <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>No rating counts recorded yet.</div>
      </Card>
    );
  }
  const total = byDay.get(last)!;
  const weekAgoDay = [...days].reverse().find((d) => d <= windowStart(last, 8));
  const perDay = weekAgoDay ? (total - byDay.get(weekAgoDay)!) / Math.max(1, (Date.parse(last) - Date.parse(weekAgoDay)) / 86_400_000) : null;
  // Installs per rating: US first-time downloads (every source) between two
  // rating counts, using only days the downloads report already covers.
  const lastDl = data.store_daily.filter((r) => r.territory === "US" && r.first_downloads > 0).map((r) => r.day).sort().at(-1);
  const ipEnd = lastDl ? [...days].reverse().find((d) => d <= lastDl) : undefined;
  const ipStart = ipEnd ? [...days].reverse().find((d) => d <= windowStart(ipEnd, 8)) : undefined;
  let installs = 0;
  if (ipStart && ipEnd) for (const r of data.store_daily) if (r.territory === "US" && r.day > ipStart && r.day <= ipEnd) installs += r.first_downloads;
  const gained = ipStart && ipEnd ? byDay.get(ipEnd)! - byDay.get(ipStart)! : 0;
  return (
    <StatStrip
      minColWidth={150}
      stats={[
        { label: "Ratings", value: int(total), note: `as of ${shortDate(last)}` },
        { label: "Average", value: avg != null ? avg.toFixed(2) : "—" },
        { label: "New per day", value: perDay != null ? perDay.toFixed(1) : "—", note: weekAgoDay ? `since ${shortDate(weekAgoDay)}` : "needs a week of counts" },
        { label: "Installs per rating", value: installs && gained > 0 ? (installs / gained).toFixed(1) : "—", note: ipStart && ipEnd ? `${shortDate(ipStart)} to ${shortDate(ipEnd)}` : "needs a week of both" },
      ]}
    />
  );
}
