"use client";

/**
 * Competitor ads tab: what the GLP-1 tracker apps (MeAgain, Shotsy, Glowise)
 * run on Meta, read from the tables Outlier's daily Ad Library scrape fills,
 * plus a Foreplay archive pull for run lengths and transcripts.
 * Reads /api/competitor-ads. Admin only.
 *
 * Layout follows Foreplay's Spyder: ads as cards with the creative first, a
 * filter bar, brands side by side, and a detail view that steps through the
 * list. Explanations sit behind "About these numbers" in each view.
 */

import * as React from "react";
import { PageHeader } from "../Shell";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { ErrorBanner, Segmented } from "../porcelain";
import { TrendChart } from "../plan/TrendChart";
import { useIsMobile } from "@/lib/useIsMobile";
import type { AdView } from "@/lib/competitor-ads-tab/logic";
import { DEFAULT_FILTER, collapseCopies, filterAds, sortAds, type AdFilter, type AdSet, type AdSort } from "@/lib/competitor-ads-tab/filters";
import type { CompetitorAdsPayload } from "@/lib/competitor-ads-tab/read";
import { AdDrawer } from "./AdDrawer";
import { AdsView, type Layout } from "./AdsView";
import { HooksView } from "./HooksView";
import { CompareView } from "./CompareView";
import { TestsView } from "./TestsView";
import { About, AdCard, CardGrid, Empty, FocusStyle, H2, MonthBars, TableBox, cell, head, left, monthLabel, num, pctText, rankText, shortDay } from "./parts";

type ViewId = "ads" | "brands" | "tests" | "hooks" | "creators" | "pages" | "launches" | "saved";
const VIEWS: { value: ViewId; label: string }[] = [
  { value: "ads", label: "Ads" },
  { value: "brands", label: "Compare brands" },
  { value: "tests", label: "Creative tests" },
  { value: "hooks", label: "Hooks" },
  { value: "creators", label: "Creators" },
  { value: "pages", label: "Store pages" },
  { value: "launches", label: "Launches" },
  { value: "saved", label: "Saved" },
];
const VIEW_KEY = "dreamme.competitorAds.view";
const BRAND_KEY = "dreamme.competitorAds.brand";
const PREFS_KEY = "dreamme.competitorAds.adsPrefs";
/** Views from the first version of the tab, mapped onto the merged Ads view. */
const OLD_VIEWS: Record<string, { view: ViewId; set?: AdSet }> = { top: { view: "ads", set: "ranked" }, movers: { view: "ads", set: "rising" } };

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
  const [view, setView] = React.useState<ViewId>("ads");
  const [brand, setBrand] = React.useState<string>("all");
  const [filter, setFilter] = React.useState<Omit<AdFilter, "brand">>(DEFAULT_FILTER);
  const [sort, setSort] = React.useState<AdSort>("rank");
  const [layout, setLayout] = React.useState<Layout>("cards");
  /** The open ad and the list it was opened from (for previous / next). */
  const [open, setOpen] = React.useState<{ ad: AdView; list: AdView[] } | null>(null);

  React.useEffect(() => {
    const v = readPref(VIEW_KEY, "view");
    if (v && OLD_VIEWS[v]) {
      setView(OLD_VIEWS[v].view);
      if (OLD_VIEWS[v].set) setFilter((f) => ({ ...f, set: OLD_VIEWS[v].set! }));
    } else if (v && VIEWS.some((x) => x.value === v)) setView(v as ViewId);
    const b = readPref(BRAND_KEY, "brand");
    if (b) setBrand(b);
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { sort?: AdSort; layout?: Layout; set?: AdSet };
      if (p.sort) setSort(p.sort);
      if (p.layout) setLayout(p.layout);
      if (p.set && !(v && OLD_VIEWS[v])) setFilter((f) => ({ ...f, set: p.set! }));
    } catch {}
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
  const rememberPrefs = (p: { sort: AdSort; layout: Layout; set: AdSet }) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
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
  /** `persist` false for a click-through from another view, so it doesn't replace the remembered set. */
  const updateFilter = (f: Partial<AdFilter>, persist = true) => {
    const { brand: b, ...rest } = f;
    if (b !== undefined) pickBrand(b);
    setFilter((cur) => {
      const next = { ...cur, ...rest };
      if (rest.set && persist) rememberPrefs({ sort, layout, set: next.set });
      return next;
    });
  };
  const pickSort = (s: AdSort) => {
    setSort(s);
    rememberPrefs({ sort: s, layout, set: filter.set });
  };
  const pickLayout = (l: Layout) => {
    setLayout(l);
    rememberPrefs({ sort, layout: l, set: filter.set });
  };
  /** From another view: show the Ads view narrowed to one creator, store page or brand. */
  const seeAds = (f: Partial<AdFilter>) => {
    updateFilter({ set: "all", runsAs: "all", format: "all", identity: null, cpp: null, query: "", ...f }, false);
    pickView("ads");
    window.scrollTo({ top: 0 });
  };

  const brandOptions = React.useMemo(() => {
    const names = (data?.brands ?? []).map((b) => b.name);
    return [{ value: "all", label: "All brands" }, ...names.map((n) => ({ value: n, label: n }))];
  }, [data]);
  React.useEffect(() => {
    if (data && brand !== "all" && !data.brands.some((b) => b.name === brand)) setBrand("all");
  }, [data, brand]);

  const savedMap = React.useMemo(() => new Map((data?.saves ?? []).map((s) => [s.ad_archive_id, s])), [data]);
  const savedIds = React.useMemo(() => new Set(savedMap.keys()), [savedMap]);
  const fullFilter: AdFilter = React.useMemo(() => ({ ...filter, brand }), [filter, brand]);
  const shownAds = React.useMemo(() => (data ? sortAds(collapseCopies(filterAds(data.ads, fullFilter)), sort) : []), [data, fullFilter, sort]);

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
  const toggleSave = (ad: AdView) => {
    const saved = savedMap.get(ad.adArchiveId);
    // A saved ad with a note opens instead, so one click on the bookmark can't throw the note away.
    if (saved?.note) {
      setOpen({ ad, list: [ad] });
      toast("This saved ad has a note. Remove it from here if you mean to.");
      return;
    }
    void (saved ? unsaveAd(ad) : saveAd(ad, ""));
  };
  const openIn = (list: AdView[]) => (ad: AdView) => setOpen({ ad, list: list.some((a) => a.id === ad.id) ? list : [ad] });
  const openOne = (ad: AdView) => setOpen({ ad, list: [ad] });
  const openIndex = open ? open.list.findIndex((a) => a.id === open.ad.id) : -1;
  const step = (d: number) => (open && open.list[openIndex + d] ? () => setOpen({ ad: open.list[openIndex + d], list: open.list }) : null);

  const rankedOn = data?.brands.map((b) => b.rankDay).filter(Boolean).sort().at(-1) ?? null;
  const subtitle = `What the GLP-1 tracker apps run on Meta, from Outlier's daily Ad Library scrape${rankedOn ? `, ranked ${shortDay(rankedOn)}` : ""}.`;

  const savedAds = React.useMemo(() => {
    if (!data) return [];
    const byId = new Map([...data.ads, ...data.savedEnded].map((a) => [a.adArchiveId, a]));
    return data.saves.map((s) => ({ s, ad: byId.get(s.ad_archive_id) })).filter((r): r is { s: (typeof data.saves)[number]; ad: AdView } => !!r.ad && (brand === "all" || r.ad.brand === brand));
  }, [data, brand]);

  return (
    <div style={{ maxWidth: 1240 }}>
      <FocusStyle />
      <PageHeader
        title="Competitor ads"
        subtitle={subtitle}
        actions={
          <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={() => void load()} disabled={loading}>
            Reload
          </Button>
        }
      />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented value={view} onChange={pickView} options={VIEWS} />
        </div>
        {data && data.brands.length > 1 && (
          <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto", marginLeft: isMobile ? 0 : "auto" }}>
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

      {!data && loading && <Skeleton isMobile={isMobile} />}

      {data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity 160ms ease" }}>
          {(data.sources.archive === "local" || data.sources.hooks === "local") && (
            <p style={{ font: "400 13px var(--font-ui)", color: "var(--warning-text)", margin: "14px 0 0" }}>
              Development: the archive and hooks come from the vault files, and picks or saves stay in memory.
            </p>
          )}
          {view === "ads" && (
            <AdsView
              all={data.ads}
              shown={shownAds}
              filter={fullFilter}
              onFilter={updateFilter}
              sort={sort}
              onSort={pickSort}
              layout={layout}
              onLayout={pickLayout}
              savedIds={savedIds}
              onOpen={openIn(shownAds)}
              onToggleSave={toggleSave}
              isMobile={isMobile}
            />
          )}
          {view === "brands" && <CompareView data={data} brand={brand} isMobile={isMobile} onOpen={openOne} onSeeAds={(b) => seeAds({ brand: b, set: "ranked" })} />}
          {view === "tests" && <TestsView stamp={data.generatedAt} liveAds={data.ads} brand={brand} isMobile={isMobile} onOpen={(ad, list) => setOpen({ ad, list })} />}
          {view === "creators" && <CreatorsView data={data} brand={brand} onSeeAds={(identity, b) => seeAds({ identity, brand: b })} />}
          {view === "pages" && <PagesView data={data} brand={brand} onSeeAds={(cpp, b) => seeAds({ cpp, brand: b })} />}
          {view === "hooks" && <HooksView ads={data.ads} hooks={data.hooks} brand={brand} source={data.sources.hooks} isMobile={isMobile} onOpen={(ad, list) => setOpen({ ad, list })} />}
          {view === "launches" && <LaunchesView data={data} brand={brand} isMobile={isMobile} />}
          {view === "saved" && (
            <SavedView rows={savedAds} liveIds={new Set(data.ads.map((a) => a.adArchiveId))} showBrand={brand === "all"} isMobile={isMobile} onOpen={openIn(savedAds.map((r) => r.ad))} onToggleSave={toggleSave} />
          )}
        </div>
      )}

      <AdDrawer
        ad={open?.ad ?? null}
        saved={open ? savedMap.get(open.ad.adArchiveId) ?? null : null}
        position={open && open.list.length > 1 && openIndex >= 0 ? { index: openIndex, total: open.list.length } : null}
        onPrev={step(-1)}
        onNext={step(1)}
        onClose={() => setOpen(null)}
        onSave={saveAd}
        onUnsave={unsaveAd}
      />
    </div>
  );
}

function Skeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <div aria-busy="true" style={{ marginTop: 24 }}>
      <div style={{ height: 34, width: 420, maxWidth: "100%", borderRadius: 10, background: "var(--bg-2)", marginBottom: 20 }} />
      <CardGrid isMobile={isMobile}>
        {Array.from({ length: isMobile ? 4 : 8 }, (_, i) => (
          <div key={i}>
            <div style={{ aspectRatio: "9 / 16", borderRadius: 10, background: "var(--bg-2)" }} />
            <div style={{ height: 12, width: "40%", borderRadius: 4, background: "var(--bg-2)", marginTop: 10 }} />
            <div style={{ height: 12, width: "85%", borderRadius: 4, background: "var(--bg-2)", marginTop: 8 }} />
          </div>
        ))}
      </CardGrid>
    </div>
  );
}

// ---------------------------------------------------------------- creators

function CreatorsView({ data, brand, onSeeAds }: { data: CompetitorAdsPayload; brand: string; onSeeAds: (identity: string, brand: string) => void }) {
  const rows = brand === "all" ? data.identities : data.identities.filter((i) => i.brand === brand);
  if (!rows.length) return <div style={{ marginTop: 24 }}><Empty title="No live ads to group">Accounts show here once a brand has live ads.</Empty></div>;
  return (
    <>
      <H2>Who the ads run as</H2>
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
                <button onClick={() => onSeeAds(r.identity, r.brand)} className="cad-focus" style={{ all: "unset", cursor: "pointer", color: "var(--link)", font: "500 13px var(--font-ui)", borderRadius: 4 }} title={`See ${r.identity}'s live ads`}>
                  {r.identity}
                </button>
                <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-2)" }}>{r.isPartnership ? "Creator account" : "Brand page"}</div>
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
      <About>
        <p style={{ margin: 0 }}>
          A creator account runs the ad under its own name &ldquo;with&rdquo; the brand. Click an account to see its live ads. Earliest ad and Ads seen include Foreplay&rsquo;s partnership history (MeAgain from Aug 14, saved Nov 23), so they reach back before Outlier started naming accounts on Nov 5. Ads outside both still carry no account name, so treat them as floors.
        </p>
      </About>
    </>
  );
}

// ---------------------------------------------------------------- store pages

function PagesView({ data, brand, onSeeAds }: { data: CompetitorAdsPayload; brand: string; onSeeAds: (cpp: string, brand: string) => void }) {
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
                  <button onClick={() => onSeeAds(p.cpp, p.brand)} className="cad-focus" style={{ all: "unset", cursor: "pointer", color: "var(--link)", font: "500 13px var(--font-ui)", borderRadius: 4 }} title="See the live ads that link to this page">
                    Page {p.cpp.slice(0, 8)}
                  </button>
                  <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-2)" }}>
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
      <About>
        <p style={{ margin: 0 }}>Outlier misses the link on many live ads, so the page counts are floors. Click a page to see the ads that send people to it.</p>
      </About>
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
      {rows.length > 0 && (
        <About>
          <p style={{ margin: 0 }}>
            From the Foreplay archive pulled {shortDay(data.archive.pulledOn)}: run lengths come from Foreplay, because Outlier end-dated ads late before Nov 5. A share counts only ads launched long enough before the pull; &ldquo;of N&rdquo; marks a month where that&apos;s not all of them. Topics are keyword matches on the headline, the first line of copy and the opening of the transcript, so treat small groups as leads.
          </p>
        </About>
      )}
    </>
  );
}

// ---------------------------------------------------------------- saved

function SavedView({
  rows,
  liveIds,
  showBrand,
  isMobile,
  onOpen,
  onToggleSave,
}: {
  rows: { s: { ad_archive_id: string; note: string; saved_at: string }; ad: AdView }[];
  liveIds: Set<string>;
  showBrand: boolean;
  isMobile: boolean;
  onOpen: (a: AdView) => void;
  onToggleSave: (a: AdView) => void;
}) {
  if (!rows.length) {
    return (
      <div style={{ marginTop: 24 }}>
        <Empty title="Nothing saved yet">Save an ad from its card or its detail, with a note if you like. Saved ads stay here after they stop running.</Empty>
      </div>
    );
  }
  return (
    <>
      <H2>Saved ads</H2>
      <CardGrid isMobile={isMobile}>
        {rows.map(({ s, ad }) => (
          <div key={s.ad_archive_id} style={{ minWidth: 0 }}>
            <AdCard ad={ad} showBrand={showBrand} saved onOpen={onOpen} onToggleSave={onToggleSave} />
            <div style={{ font: "400 12px/1.45 var(--font-ui)", color: "var(--ink-2)", padding: "4px 2px 0" }}>
              {liveIds.has(s.ad_archive_id) ? "Still live" : "No longer running"}, saved {shortDay(s.saved_at)}
            </div>
            {s.note && <div style={{ font: "400 13px/1.45 var(--font-ui)", color: "var(--ink)", padding: "4px 2px 0", whiteSpace: "pre-wrap" }}>{s.note}</div>}
          </div>
        ))}
      </CardGrid>
    </>
  );
}
