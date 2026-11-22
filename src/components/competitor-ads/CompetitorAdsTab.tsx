"use client";

/**
 * Competitor ads tab: what the GLP-1 tracker apps (MeAgain, Shotsy, Glowise)
 * run on Meta, read from the tables Outlier's daily Ad Library scrape fills,
 * plus a Foreplay archive pull for run lengths and transcripts.
 * Reads /api/competitor-ads. Admin only.
 */

import * as React from "react";
import { PageHeader } from "../Shell";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { ErrorBanner, Segmented } from "../porcelain";
import { TrendChart } from "../plan/TrendChart";
import { useIsMobile } from "@/lib/useIsMobile";
import { SIGNALS, type AdView } from "@/lib/competitor-ads-tab/logic";
import type { CompetitorAdsPayload, HookView } from "@/lib/competitor-ads-tab/read";
import { AdDrawer } from "./AdDrawer";
import { AdCell, Empty, H2, MixBar, MonthBars, Move, Note, TableBox, cell, head, left, monthLabel, num, pctText, rankText, shortDay } from "./parts";

type ViewId = "brands" | "top" | "movers" | "creators" | "pages" | "hooks" | "launches" | "saved";
const VIEWS: { value: ViewId; label: string }[] = [
  { value: "brands", label: "Brands" },
  { value: "top", label: "Top ads" },
  { value: "movers", label: "Breakouts" },
  { value: "creators", label: "Creators" },
  { value: "pages", label: "Store pages" },
  { value: "hooks", label: "Hooks" },
  { value: "launches", label: "Launches" },
  { value: "saved", label: "Saved" },
];
const VIEW_KEY = "dreamme.competitorAds.view";
const BRAND_KEY = "dreamme.competitorAds.brand";

function readPref(key: string, param: string): string | null {
  try {
    return new URL(window.location.href).searchParams.get(param) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function CompetitorAdsTab() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [data, setData] = React.useState<CompetitorAdsPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<ViewId>("brands");
  const [brand, setBrand] = React.useState<string>("all");
  const [open, setOpen] = React.useState<AdView | null>(null);

  React.useEffect(() => {
    const v = readPref(VIEW_KEY, "view");
    if (v && VIEWS.some((x) => x.value === v)) setView(v as ViewId);
    const b = readPref(BRAND_KEY, "brand");
    if (b) setBrand(b);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/competitor-ads", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as CompetitorAdsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const remember = (key: string, param: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      const url = new URL(window.location.href);
      url.searchParams.set(param, value);
      window.history.replaceState(null, "", url.toString());
    } catch {}
  };
  const pickView = (v: string) => {
    setView(v as ViewId);
    remember(VIEW_KEY, "view", v);
  };
  const pickBrand = (b: string) => {
    setBrand(b);
    remember(BRAND_KEY, "brand", b);
  };

  const brandOptions = React.useMemo(() => {
    const names = (data?.brands ?? []).map((b) => b.name);
    return [{ value: "all", label: "All brands" }, ...names.map((n) => ({ value: n, label: n }))];
  }, [data]);
  React.useEffect(() => {
    if (data && brand !== "all" && !data.brands.some((b) => b.name === brand)) setBrand("all");
  }, [data, brand]);

  const inBrand = React.useCallback(<T extends { brand: string }>(rows: T[]) => (brand === "all" ? rows : rows.filter((r) => r.brand === brand)), [brand]);
  const savedMap = React.useMemo(() => new Map((data?.saves ?? []).map((s) => [s.ad_archive_id, s])), [data]);

  const saveAd = async (ad: AdView, note: string) => {
    const res = await fetch("/api/competitor-ads/saves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adArchiveId: ad.adArchiveId, pageId: ad.pageId, note }),
    });
    const b = await res.json();
    if (!b.ok) return toast(`Couldn't save: ${b.error ?? res.status}`);
    setData((d) =>
      d
        ? {
            ...d,
            saves: [{ ad_archive_id: ad.adArchiveId, page_id: ad.pageId, note, saved_at: savedMap.get(ad.adArchiveId)?.saved_at ?? new Date().toISOString() }, ...d.saves.filter((s) => s.ad_archive_id !== ad.adArchiveId)],
            savedEnded: d.ads.some((a) => a.adArchiveId === ad.adArchiveId) || d.savedEnded.some((a) => a.adArchiveId === ad.adArchiveId) ? d.savedEnded : [ad, ...d.savedEnded],
          }
        : d,
    );
    toast(savedMap.has(ad.adArchiveId) ? "Note saved" : "Saved");
  };
  const unsaveAd = async (ad: AdView) => {
    const res = await fetch(`/api/competitor-ads/saves?id=${ad.adArchiveId}`, { method: "DELETE" });
    const b = await res.json();
    if (!b.ok) return toast(`Couldn't remove: ${b.error ?? res.status}`);
    setData((d) => (d ? { ...d, saves: d.saves.filter((s) => s.ad_archive_id !== ad.adArchiveId) } : d));
    toast("Removed from saved");
  };
  const setPick = async (h: HookView, pick: HookView["pick"]) => {
    const prev = h.pick;
    setData((d) => (d ? { ...d, hooks: d.hooks.map((x) => (x.id === h.id ? { ...x, pick } : x)) } : d));
    const res = await fetch(`/api/competitor-ads/hooks/${encodeURIComponent(h.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick }),
    });
    const b = await res.json().catch(() => ({ ok: false }));
    if (!b.ok) {
      setData((d) => (d ? { ...d, hooks: d.hooks.map((x) => (x.id === h.id ? { ...x, pick: prev } : x)) } : d));
      toast(`Couldn't save the pick: ${b.error ?? res.status}`);
    }
  };

  const rankedOn = data?.brands.map((b) => b.rankDay).filter(Boolean).sort().at(-1) ?? null;
  const subtitle = data
    ? `What the GLP-1 tracker apps run on Meta, from Outlier's daily Ad Library scrape${rankedOn ? `, ranked ${shortDay(rankedOn)}` : ""}.`
    : "What the GLP-1 tracker apps run on Meta, from Outlier's daily Ad Library scrape.";

  return (
    <div style={{ maxWidth: 1180 }}>
      <PageHeader
        title="Competitor ads"
        subtitle={subtitle}
        actions={
          <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={() => void load()} disabled={loading}>
            Reload
          </Button>
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 6 }}>
        <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented value={view} onChange={pickView} options={VIEWS} />
        </div>
        {data && data.brands.length > 1 && (
          <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
            <Segmented size="sm" value={brand} onChange={pickBrand} options={brandOptions} />
          </div>
        )}
      </div>

      {error && (
        <ErrorBanner>
          <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 260px" }}>Couldn&apos;t load competitor ads: {error}</span>
            <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={() => void load()}>
              Try again
            </Button>
          </span>
        </ErrorBanner>
      )}

      {!data && loading && <Skeleton />}

      {data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity 160ms ease" }}>
          {(data.sources.archive === "local" || data.sources.hooks === "local") && (
            <Note style={{ marginTop: 14, color: "var(--warning-text)" }}>
              Development: the archive and hooks are read from the vault files and picks or saves live in memory until migration 0122 runs.
            </Note>
          )}
          {view === "brands" && <BrandsView data={data} brand={brand} isMobile={isMobile} />}
          {view === "top" && <TopView ads={inBrand(data.ads)} showBrand={brand === "all"} onOpen={setOpen} isMobile={isMobile} />}
          {view === "movers" && <MoversView ads={inBrand(data.ads)} showBrand={brand === "all"} onOpen={setOpen} isMobile={isMobile} />}
          {view === "creators" && <CreatorsView data={data} brand={brand} />}
          {view === "pages" && <PagesView data={data} brand={brand} />}
          {view === "hooks" && <HooksView hooks={brand === "all" ? data.hooks : data.hooks.filter((h) => h.brand === brand.toLowerCase())} onPick={setPick} source={data.sources.hooks} />}
          {view === "launches" && <LaunchesView data={data} brand={brand} isMobile={isMobile} />}
          {view === "saved" && <SavedView data={data} brand={brand} onOpen={setOpen} />}
        </div>
      )}

      <AdDrawer ad={open} saved={open ? savedMap.get(open.adArchiveId) ?? null : null} onClose={() => setOpen(null)} onSave={saveAd} onUnsave={unsaveAd} />
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" style={{ display: "grid", gap: 10, marginTop: 24 }}>
      {[80, 220, 220].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 14, background: "var(--bg-2)", opacity: 0.7 }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- brands

function BrandsView({ data, brand, isMobile }: { data: CompetitorAdsPayload; brand: string; isMobile: boolean }) {
  const brands = brand === "all" ? data.brands : data.brands.filter((b) => b.name === brand);
  return (
    <>
      <H2>Live ads by brand</H2>
      <TableBox minWidth={760}>
        <thead>
          <tr>
            <th scope="col" style={{ ...head, ...left }}>Brand</th>
            <th scope="col" style={head}>Live ads</th>
            <th scope="col" style={head}>A week ago</th>
            <th scope="col" style={head}>As creators</th>
            <th scope="col" style={{ ...head, ...left, width: "34%" }}>Format</th>
            <th scope="col" style={head}>Days ranked, last 14</th>
          </tr>
        </thead>
        <tbody>
          {brands.map((b) => {
            const last = b.daily.at(-1);
            const weekAgo = b.daily.find((d) => d.day === addDaysClient(last?.day ?? "", -7));
            const scraped = b.pages.map((p) => p.lastScrapedAt).filter(Boolean).sort().at(-1) ?? null;
            const firstRank = b.rankDays ? String(b.rankDays) : null;
            return (
              <tr key={b.key}>
                <th scope="row" style={{ ...cell, ...left, fontWeight: 600 }}>
                  {b.name}
                  <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 2 }}>
                    {scraped ? `Scraped ${shortDay(scraped)}` : "Not scraped yet"}
                    {b.pages.length > 1 ? ` · ${b.pages.length} pages` : ""}
                  </div>
                </th>
                <td style={{ ...cell, font: "600 15px var(--font-ui)" }}>{num(b.live)}</td>
                <td style={cell}>{weekAgo ? num(weekAgo.active) : "—"}</td>
                <td style={cell}>{b.live ? pctText(data.ads.filter((a) => a.brand === b.name && a.isPartnership).length / b.live) : "—"}</td>
                <td style={{ ...cell, ...left, paddingRight: 24 }}>
                  <MixBar mix={b.mix} />
                </td>
                <td style={{ ...cell, color: b.rankFresh ? "var(--ink)" : "var(--ink-3)" }}>{firstRank ?? (scraped ? "No ranks yet" : "—")}</td>
              </tr>
            );
          })}
        </tbody>
      </TableBox>
      <Note style={{ marginTop: 10 }}>
        &ldquo;No creative yet&rdquo; is a live ad whose video or image wasn&apos;t in the scrape, usually because it started the day before. Dosely and Pep AI aren&apos;t tracked: each would be one more row in Outlier&apos;s brand list and a few ScrapeCreators credits a day.
      </Note>

      <H2>Live ads per day</H2>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 18 }}>
        {brands.map((b) => {
          const pts = b.daily.slice(-120).map((d) => ({ x: d.day, y: d.active, note: `${d.video} video, ${d.dco} DCO, ${d.image} image${d.other ? `, ${d.other} other` : ""}` }));
          return (
            <div key={b.key} style={{ minWidth: 0 }}>
              <div style={{ font: "600 13px var(--font-ui)", color: "var(--ink)", marginBottom: 6 }}>{b.name}</div>
              {pts.length >= 2 ? (
                <TrendChart points={pts} color="var(--cat-1)" format={(v) => num(v)} ariaLabel={`${b.name} live ads per day`} height={160} />
              ) : (
                <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)", padding: "24px 0" }}>No daily counts yet. They start with the first daily scrape.</div>
              )}
            </div>
          );
        })}
      </div>
      <Note style={{ marginTop: 10 }}>Counts before Nov 5 were seeded from Foreplay; Outlier counts every identity, so its numbers run above Foreplay&apos;s.</Note>
    </>
  );
}

const addDaysClient = (day: string, n: number) => (day ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : "");

// ---------------------------------------------------------------- top ads

function AdTable({ ads, showBrand, onOpen, isMobile, limit }: { ads: AdView[]; showBrand: boolean; onOpen: (a: AdView) => void; isMobile: boolean; limit?: number }) {
  const [all, setAll] = React.useState(false);
  const shown = !limit || all ? ads : ads.slice(0, limit);
  if (!ads.length) return null;
  const more = limit && ads.length > limit && !all && (
    <div style={{ marginTop: 10 }}>
      <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
        Show all {ads.length}
      </Button>
    </div>
  );
  if (isMobile) {
    return (
      <>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {shown.map((a) => (
            <li key={a.id} style={{ borderTop: "1px solid var(--line)" }}>
              <button onClick={() => onOpen(a)} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "10px 0", boxSizing: "border-box" }}>
                <AdCell ad={a} showBrand={showBrand} />
                <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 6, font: "400 12px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{rankText(a.rank.now)}</span>
                  <span>
                    7d {rankText(a.rank.ago7)} · <Move now={a.rank.now} before={a.rank.ago7} runDays={a.runDays} observed={a.rank.observed} />
                  </span>
                  <span>{num(a.runDays)} days live</span>
                  <span>
                    {a.confidence.met} of {a.confidence.of} signals
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {more}
      </>
    );
  }
  return (
    <>
      <TableBox minWidth={980}>
        <thead>
          <tr>
            <th scope="col" style={head}>Rank</th>
            <th scope="col" style={{ ...head, ...left, paddingLeft: 6 }}>Ad</th>
            <th scope="col" style={head}>7 days ago</th>
            <th scope="col" style={head}>14 days ago</th>
            <th scope="col" style={head}>Days in top 20</th>
            <th scope="col" style={head}>Days live</th>
            <th scope="col" style={head}>Copies</th>
            <th scope="col" style={head}>Signals</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <tr
              key={a.id}
              tabIndex={0}
              onClick={() => onOpen(a)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(a))}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td style={{ ...cell, font: "600 14px var(--font-ui)", width: 56 }}>{rankText(a.rank.now)}</td>
              <td style={{ ...cell, ...left, paddingLeft: 6 }}>
                <AdCell ad={a} showBrand={showBrand} />
              </td>
              <td style={cell}>
                {rankText(a.rank.ago7)}
                <div style={{ font: "400 12px var(--font-ui)" }}>
                  <Move now={a.rank.now} before={a.rank.ago7} runDays={a.runDays} observed={a.rank.observed} />
                </div>
              </td>
              <td style={cell}>{rankText(a.rank.ago14)}</td>
              <td style={cell}>{a.rank.observed ? `${a.rank.top20} of ${a.rank.observed}` : "—"}</td>
              <td style={cell}>{num(a.runDays)}</td>
              <td style={cell}>{a.copies}</td>
              <td style={cell} title={a.confidence.signals.map((s) => `${s.met ? "Yes" : "No"}: ${s.label}`).join("\n")}>
                <span style={{ fontWeight: 600, color: a.confidence.of && a.confidence.met === a.confidence.of ? "var(--success-text)" : "var(--ink)" }}>{a.confidence.met}</span>
                <span style={{ color: "var(--ink-3)" }}> of {a.confidence.of}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </TableBox>
      {more}
    </>
  );
}

function TopView({ ads, showBrand, onOpen, isMobile }: { ads: AdView[]; showBrand: boolean; onOpen: (a: AdView) => void; isMobile: boolean }) {
  const ranked = ads.filter((a) => a.rank.now != null);
  const unranked = ads.length - ranked.length;
  if (!ads.length) return <div style={{ marginTop: 24 }}><Empty title="No live ads for this brand">Ads show here once Outlier&apos;s daily scrape finds them.</Empty></div>;
  return (
    <>
      <H2>Ranked by Meta&apos;s delivery</H2>
      <Note>
        The Ad Library&apos;s impressions order, snapshotted every morning. It counts lifetime impressions, so older ads drift up. Signals count how many of these agree, out of those the ad has: top {SIGNALS.topRank} today, top {SIGNALS.topRank} on {SIGNALS.persistDays}+ of the last 14 days, live {SIGNALS.longRunDays}+ days, {SIGNALS.copies}+ live copies, EU reach in the brand&apos;s top quarter.
      </Note>
      {ranked.length ? <AdTable ads={ranked} showBrand={showBrand} onOpen={onOpen} isMobile={isMobile} limit={50} /> : <Empty title="No ranks yet">This brand&apos;s ads are live but haven&apos;t been ranked; the first rank lands with the next daily scrape.</Empty>}
      {unranked > 0 && <Note style={{ marginTop: 12 }}>{unranked} live {unranked === 1 ? "ad has" : "ads have"} no rank from the last 48 hours.</Note>}
    </>
  );
}

// ---------------------------------------------------------------- breakouts / evergreen

function MoversView({ ads, showBrand, onOpen, isMobile }: { ads: AdView[]; showBrand: boolean; onOpen: (a: AdView) => void; isMobile: boolean }) {
  const byRank = (a: AdView, b: AdView) => (a.rank.now ?? 1e9) - (b.rank.now ?? 1e9);
  const fast = ads.filter((a) => a.buckets.includes("breakout") || a.buckets.includes("riser")).sort(byRank);
  const slow = ads.filter((a) => a.buckets.includes("evergreen") || a.buckets.includes("steady")).sort(byRank);
  return (
    <>
      <H2>Breakouts and fast risers</H2>
      <Note>Breakout: top 50, live 14 days or less, and new or at least twice as high as a week ago. Fast riser: top 50 and 20+ places higher than a week ago.</Note>
      {fast.length ? <AdTable ads={fast} showBrand={showBrand} onOpen={onOpen} isMobile={isMobile} /> : <Empty title="No breakouts right now">They need a week of daily ranks to compare against.</Empty>}
      <H2>Evergreen and steady</H2>
      <Note>Evergreen: top 5 now and a week ago, live 30+ days. Steady: live 30+ days and in the top 50 on 80% of the last 14 days.</Note>
      {slow.length ? <AdTable ads={slow} showBrand={showBrand} onOpen={onOpen} isMobile={isMobile} /> : <Empty title="No long-running leaders yet">These need 10+ days of daily ranks.</Empty>}
    </>
  );
}

// ---------------------------------------------------------------- creators

function CreatorsView({ data, brand }: { data: CompetitorAdsPayload; brand: string }) {
  const rows = brand === "all" ? data.identities : data.identities.filter((i) => i.brand === brand);
  if (!rows.length) return <div style={{ marginTop: 24 }}><Empty title="No live ads to group">Accounts show here once a brand has live ads.</Empty></div>;
  return (
    <>
      <H2>Who the ads run as</H2>
      <Note>Each partnership ad runs under a creator&apos;s account &ldquo;with&rdquo; the brand. Earliest ad is a floor: ads that ended before Nov 5 carry no account name.</Note>
      <TableBox minWidth={720}>
        <thead>
          <tr>
            <th scope="col" style={{ ...head, ...left }}>Account</th>
            {brand === "all" && <th scope="col" style={{ ...head, ...left }}>Brand</th>}
            <th scope="col" style={head}>Live ads</th>
            <th scope="col" style={head}>In top 20</th>
            <th scope="col" style={head}>Best rank</th>
            <th scope="col" style={head}>Earliest ad</th>
            <th scope="col" style={head}>Ads seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.brand}-${r.identity}`}>
              <th scope="row" style={{ ...cell, ...left, fontWeight: 500 }}>
                {r.identity}
                <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{r.isPartnership ? "Partnership" : "Brand page"}</div>
              </th>
              {brand === "all" && <td style={{ ...cell, ...left }}>{r.brand}</td>}
              <td style={{ ...cell, fontWeight: 600 }}>{num(r.live)}</td>
              <td style={cell}>{num(r.top20)}</td>
              <td style={cell}>{rankText(r.bestRank)}</td>
              <td style={cell}>{shortDay(r.firstSeen)}</td>
              <td style={cell}>{num(r.adsSeen)}</td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </>
  );
}

// ---------------------------------------------------------------- store pages

function PagesView({ data, brand }: { data: CompetitorAdsPayload; brand: string }) {
  const pages = brand === "all" ? data.cpps : data.cpps.filter((p) => p.brand === brand);
  const mix = brand === "all" ? data.landing : data.landing.filter((m) => m.brand === brand);
  return (
    <>
      <H2>Where the clicks go</H2>
      <TableBox minWidth={640}>
        <thead>
          <tr>
            <th scope="col" style={{ ...head, ...left }}>Brand</th>
            <th scope="col" style={head}>Live ads</th>
            <th scope="col" style={head}>Custom page</th>
            <th scope="col" style={head}>Default page</th>
            <th scope="col" style={head}>Google Play</th>
            <th scope="col" style={head}>Web</th>
            <th scope="col" style={head}>No link captured</th>
          </tr>
        </thead>
        <tbody>
          {mix.map((m) => (
            <tr key={m.brand}>
              <th scope="row" style={{ ...cell, ...left, fontWeight: 500 }}>{m.brand}</th>
              <td style={cell}>{num(m.live)}</td>
              <td style={{ ...cell, fontWeight: 600 }}>{num(m.appStoreCpp)}</td>
              <td style={cell}>{num(m.appStoreDefault)}</td>
              <td style={cell}>{num(m.play)}</td>
              <td style={cell}>{num(m.web)}</td>
              <td style={{ ...cell, color: "var(--ink-3)" }}>{num(m.none)}</td>
            </tr>
          ))}
        </tbody>
      </TableBox>
      <Note style={{ marginTop: 10 }}>Outlier misses the link on many live ads, so the page counts are floors.</Note>

      <H2>Custom Product Pages</H2>
      {pages.length ? (
        <TableBox minWidth={820}>
          <thead>
            <tr>
              <th scope="col" style={{ ...head, ...left }}>Page</th>
              <th scope="col" style={head}>Live ads</th>
              <th scope="col" style={head}>In top 20</th>
              <th scope="col" style={head}>Best rank</th>
              <th scope="col" style={head}>First ad</th>
              <th scope="col" style={{ ...head, ...left, paddingLeft: 12 }}>Best-ranked hooks</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={`${p.brand}-${p.cpp}`}>
                <th scope="row" style={{ ...cell, ...left, fontWeight: 500, whiteSpace: "nowrap" }}>
                  <code style={{ font: "500 12.5px var(--font-mono)" }}>{p.cpp.slice(0, 8)}</code>
                  <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
                    {brand === "all" ? `${p.brand} · ` : ""}
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>
                        Open the page
                      </a>
                    ) : (
                      "No app id"
                    )}
                  </div>
                </th>
                <td style={{ ...cell, fontWeight: 600 }}>{num(p.live)}</td>
                <td style={cell}>{num(p.top20)}</td>
                <td style={cell}>{rankText(p.bestRank)}</td>
                <td style={cell}>{shortDay(p.firstStarted)}</td>
                <td style={{ ...cell, ...left, paddingLeft: 12, maxWidth: 420 }}>
                  {p.sampleHooks.map((h, i) => (
                    <div key={i} style={{ font: "400 12.5px/1.4 var(--font-ui)", color: i ? "var(--ink-2)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      ) : (
        <Empty title="No Custom Product Pages in the live ads">A page shows here when a live ad&apos;s link carries a page id.</Empty>
      )}
    </>
  );
}

// ---------------------------------------------------------------- hooks

const PICKS: { value: NonNullable<HookView["pick"]>; label: string }[] = [
  { value: "brief", label: "Brief it" },
  { value: "maybe", label: "Maybe" },
  { value: "skip", label: "Skip" },
];

function HooksView({ hooks, onPick, source }: { hooks: HookView[]; onPick: (h: HookView, p: HookView["pick"]) => void; source: string }) {
  const [tier, setTier] = React.useState("all");
  const [pickF, setPickF] = React.useState("all");
  const shown = hooks.filter((h) => (tier === "all" || h.tier === tier) && (pickF === "all" || (pickF === "none" ? !h.pick : h.pick === pickF)));
  const hookDate = /(\d{4}-\d{2}-\d{2})/.exec(hooks[0]?.source_file ?? "")?.[1] ?? null;
  const counts = PICKS.map((p) => `${hooks.filter((h) => h.pick === p.value).length} ${p.label.toLowerCase()}`).join(", ");
  if (!hooks.length) {
    return (
      <div style={{ marginTop: 24 }}>
        <Empty title="The hook database isn't loaded">
          {source === "missing" ? "Run scripts/import-competitor-archive.ts with --hooks once migration 0122 is live." : "No hooks for this brand."}
        </Empty>
      </div>
    );
  }
  return (
    <>
      <H2 right={<span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>{counts}</span>}>Hooks from long-running videos</H2>
      <Note>
        On-screen text of the first 3 seconds of competitor videos that ran 21+ days{hookDate ? ` (read ${shortDay(hookDate)})` : ""}, scored within each brand: half run length, 30% copies, 20% still live.
      </Note>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented size="sm" value={tier} onChange={setTier} options={[{ value: "all", label: "All tiers" }, { value: "A", label: "Tier A" }, { value: "B", label: "Tier B" }, { value: "C", label: "Tier C" }]} />
        </div>
        <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented size="sm" value={pickF} onChange={setPickF} options={[{ value: "all", label: "Any pick" }, { value: "none", label: "Not picked" }, ...PICKS]} />
        </div>
      </div>
      <TableBox minWidth={900}>
        <thead>
          <tr>
            <th scope="col" style={head}>#</th>
            <th scope="col" style={{ ...head, ...left, paddingLeft: 6 }}>Hook</th>
            <th scope="col" style={head}>Days</th>
            <th scope="col" style={head}>Ads</th>
            <th scope="col" style={head}>Live</th>
            <th scope="col" style={head}>Score</th>
            <th scope="col" style={{ ...head, ...left, paddingLeft: 12 }}>Pick</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((h) => (
            <tr key={h.id}>
              <td style={{ ...cell, color: "var(--ink-3)", width: 36 }}>{h.position}</td>
              <td style={{ ...cell, ...left, paddingLeft: 6, maxWidth: 460 }}>
                <div style={{ font: "500 13px/1.4 var(--font-ui)" }}>{h.hook}</div>
                <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 2 }}>
                  {h.brand === "meagain" ? "MeAgain" : h.brand === "shotsy" ? "Shotsy" : h.brand} · {h.identity ?? "—"} · {h.hook_type ?? "—"}
                  {h.ad_archive_id && (
                    <>
                      {" · "}
                      <a href={`https://www.facebook.com/ads/library/?id=${h.ad_archive_id}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>
                        Ad Library
                      </a>
                    </>
                  )}
                </div>
              </td>
              <td style={cell}>{num(h.max_days)}</td>
              <td style={cell}>{num(h.ads)}</td>
              <td style={cell}>{num(h.live)}</td>
              <td style={cell}>
                {num(h.score)} <span style={{ color: "var(--ink-3)" }}>{h.tier}</span>
              </td>
              <td style={{ ...cell, ...left, paddingLeft: 12 }}>
                <div role="radiogroup" aria-label={`Pick for hook ${h.position}`} style={{ display: "inline-flex", gap: 4 }}>
                  {PICKS.map((p) => {
                    const on = h.pick === p.value;
                    return (
                      <button
                        key={p.value}
                        role="radio"
                        aria-checked={on}
                        onClick={() => onPick(h, on ? null : p.value)}
                        style={{
                          font: `${on ? 600 : 500} 12px var(--font-ui)`,
                          padding: "5px 9px",
                          minHeight: 0,
                          borderRadius: 8,
                          cursor: "pointer",
                          border: `1px solid ${on ? "var(--accent)" : "var(--line-2)"}`,
                          background: on ? "var(--accent-soft)" : "var(--surface)",
                          color: on ? "var(--accent-text)" : "var(--ink-2)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </>
  );
}

// ---------------------------------------------------------------- launches and survival

function LaunchesView({ data, brand, isMobile }: { data: CompetitorAdsPayload; brand: string; isMobile: boolean }) {
  const rows = brand === "all" ? data.archive.brands : data.archive.brands.filter((b) => b.brand === brand);
  const brandsDaily = brand === "all" ? data.brands : data.brands.filter((b) => b.name === brand);
  const pulledBrands = data.archive.brands.map((b) => b.brand).join(" and ");
  // A share with fewer ads than the month launched covers only its older ads; say how many.
  const share = (v: number | null, n: number, launched: number) =>
    v == null ? "—" : n < launched ? (
      <>
        {pctText(v)} <span style={{ color: "var(--ink-3)", fontSize: 12 }}>of {n}</span>
      </>
    ) : (
      pctText(v)
    );
  return (
    <>
      {rows.length > 0 && (
        <Note style={{ marginTop: 18 }}>
          From the Foreplay archive pulled {shortDay(data.archive.pulledOn)}: run lengths come from Foreplay, because Outlier end-dated ads late before Nov 5. A share counts only ads launched long enough before the pull; &ldquo;of N&rdquo; marks a month where that&apos;s not all of them. Topics are keyword matches on the headline, the first line of copy and the opening of the transcript, so treat small groups as leads.
        </Note>
      )}
      {!rows.length ? (
        <div style={{ marginTop: 24 }}>
          <Empty title="No archive pull for this brand">
            Launch and survival figures come from a Foreplay archive pull{pulledBrands ? `, which covers ${pulledBrands} (${shortDay(data.archive.pulledOn)})` : ""}.
          </Empty>
        </div>
      ) : (
        rows.map((b) => {
          // The last 8 months: older ones are thin and crowd the chart.
          const months = b.months.filter((m) => m.launched >= 3).slice(-8);
          return (
            <section key={b.brand}>
              <H2>{b.brand}: ads launched per month</H2>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 0.9fr) minmax(0, 1.1fr)", gap: 22, alignItems: "start" }}>
                <MonthBars months={months} />
                <TableBox minWidth={420}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ ...head, ...left }}>Month</th>
                      <th scope="col" style={head}>Launched</th>
                      <th scope="col" style={head}>Lasted 7 days</th>
                      <th scope="col" style={head}>14 days</th>
                      <th scope="col" style={head}>30 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => (
                      <tr key={m.month}>
                        <th scope="row" style={{ ...cell, ...left, fontWeight: 500 }}>{monthLabel(m.month)}</th>
                        <td style={cell}>{num(m.launched)}</td>
                        <td style={cell}>{share(m.lasted7, m.n7, m.launched)}</td>
                        <td style={cell}>{share(m.lasted14, m.n14, m.launched)}</td>
                        <td style={cell}>{share(m.lasted30, m.n30, m.launched)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableBox>
              </div>
              <H2>{b.brand}: of ads 21+ days old, the share that ran 14+ days, by topic</H2>
              <TableBox minWidth={420}>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...head, ...left }}>Topic</th>
                    <th scope="col" style={head}>Ads</th>
                    <th scope="col" style={head}>Ran 14+ days</th>
                  </tr>
                </thead>
                <tbody>
                  {[...b.survival.topics.filter((t) => t.ads > 0), b.survival.all].map((t) => (
                    <tr key={t.key}>
                      <th scope="row" style={{ ...cell, ...left, fontWeight: t.key === "all" ? 600 : 500 }}>{t.label}</th>
                      <td style={cell}>{num(t.ads)}</td>
                      <td style={{ ...cell, fontWeight: t.key === "all" ? 600 : 400 }}>{t.lasted14 == null ? "too few" : pctText(t.lasted14)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableBox>
            </section>
          );
        })
      )}

      <H2>New ads per day since daily scraping began</H2>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 18 }}>
        {brandsDaily.map((b) => {
          const pts = b.daily.filter((d) => d.day >= "2026-11-05").map((d) => ({ x: d.day, y: d.newAds, note: `${d.endedAds} ended` }));
          return (
            <div key={b.key} style={{ minWidth: 0 }}>
              <div style={{ font: "600 13px var(--font-ui)", marginBottom: 6 }}>{b.name}</div>
              {pts.length >= 2 ? (
                <TrendChart points={pts} color="var(--cat-3)" format={(v) => num(v)} ariaLabel={`${b.name} new ads per day`} height={150} />
              ) : (
                <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)", padding: "24px 0" }}>Not enough daily scrapes yet.</div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- saved

function SavedView({ data, brand, onOpen }: { data: CompetitorAdsPayload; brand: string; onOpen: (a: AdView) => void }) {
  const byId = new Map([...data.ads, ...data.savedEnded].map((a) => [a.adArchiveId, a]));
  const rows = data.saves.map((s) => ({ s, ad: byId.get(s.ad_archive_id) })).filter((r) => r.ad && (brand === "all" || r.ad.brand === brand));
  if (!rows.length) {
    return (
      <div style={{ marginTop: 24 }}>
        <Empty title="Nothing saved yet">Open any ad and choose Save ad to keep it here with a note. Saved ads stay after they stop running.</Empty>
      </div>
    );
  }
  return (
    <>
      <H2>Saved ads</H2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map(({ s, ad }) => (
          <li key={s.ad_archive_id} style={{ borderTop: "1px solid var(--line)" }}>
            <button onClick={() => onOpen(ad!)} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "12px 0", boxSizing: "border-box" }}>
              <AdCell ad={ad!} showBrand={brand === "all"} />
              <span style={{ display: "block", marginTop: 6, font: "400 12.5px/1.45 var(--font-ui)", color: "var(--ink-2)" }}>
                {data.ads.some((a) => a.adArchiveId === s.ad_archive_id) ? `Live, ${rankText(ad!.rank.now)} today` : "No longer running"} · saved {shortDay(s.saved_at)}
                {s.note ? ` · ${s.note}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Note style={{ marginTop: 12 }}>Copy a brief from any saved ad&apos;s drawer.</Note>
    </>
  );
}
