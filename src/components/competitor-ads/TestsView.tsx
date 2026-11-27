"use client";

/**
 * Creative tests, modelled on Foreplay Spyder's screen of that name: a brand's
 * ads grouped by the day they launched. Each day reads "Nov 10: 1 of 38 still
 * running"; opening it shows every ad's thumbnail with a bar for how long it
 * ran, the longest-running one marked as the winner.
 *
 * Loads /api/competitor-ads/launches (stopped ads included) when the view
 * first opens; the grouping rules are in src/lib/competitor-ads-tab/launches.ts.
 */

import * as React from "react";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { ErrorBanner, Segmented } from "../porcelain";
import { buildAdViews, dayOf, indexRanks, type AdView } from "@/lib/competitor-ads-tab/logic";
import { groupLaunches, runText, runningText, type LaunchDay, type LaunchEntry } from "@/lib/competitor-ads-tab/launches";
import type { LaunchesPayload } from "@/lib/competitor-ads-tab/read";
import { About, Empty, H2, Thumb, adHeadline, num, shortDay } from "./parts";

type Show = "all" | "winners";
const SHOW_KEY = "dreamme.competitorAds.testsShow";
/** Rows drawn when a big launch day opens; the rest behind "Show all". */
const FIRST_ROWS = 30;

/** Launches are the same for every brand filter, so one load serves until the tab reloads. */
let cache: { stamp: string; payload: LaunchesPayload } | null = null;

export function TestsView({
  stamp,
  liveAds,
  brand,
  isMobile,
  onOpen,
}: {
  /** The main payload's time: when the tab reloads, launches load again too. */
  stamp: string;
  /** The main payload's live ads: they carry today's rank, so a live ad opens with it. */
  liveAds: AdView[];
  brand: string;
  isMobile: boolean;
  onOpen: (ad: AdView, list: AdView[]) => void;
}) {
  const [data, setData] = React.useState<LaunchesPayload | null>(cache?.stamp === stamp ? cache.payload : null);
  const [error, setError] = React.useState<string | null>(null);
  const [show, setShow] = React.useState<Show>("all");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [full, setFull] = React.useState<Set<string>>(new Set());
  const touched = React.useRef(false);

  React.useEffect(() => {
    try {
      if (localStorage.getItem(SHOW_KEY) === "winners") setShow("winners");
    } catch {}
  }, []);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/competitor-ads/launches", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      cache = { stamp, payload: body as LaunchesPayload };
      setData(cache.payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [stamp]);
  React.useEffect(() => {
    if (cache?.stamp !== stamp) void load();
  }, [load, stamp]);

  const today = data ? dayOf(data.generatedAt) : null;
  const days = React.useMemo(() => {
    if (!data || !today) return [];
    const live = new Map(liveAds.map((a) => [a.adArchiveId, a]));
    const ads = data.rows
      .filter((r) => brand === "all" || r.brand === brand)
      .map((r) => {
        const own = buildAdViews([r], r.brand, indexRanks([]), data.generatedAt, false)[0];
        // A live ad opens as the Ads view shows it (rank, copies, signals).
        const l = r.is_active ? live.get(r.ad_archive_id) : undefined;
        return l ? { ...l, endedAt: null } : own;
      });
    const trackedSince = Object.fromEntries(data.brands.map((b) => [b.name, b.trackedSince]));
    return groupLaunches(ads, today, { windowDays: data.windowDays, trackedSince });
  }, [data, today, brand, liveAds]);

  const shown = show === "winners" ? days.filter((d) => d.winner) : days;
  const keyOf = (d: LaunchDay) => `${d.brand} ${d.day}`;

  // Open the newest day with a winner, once, so the screen shows what it's for.
  React.useEffect(() => {
    if (touched.current || !days.length) return;
    const first = days.find((d) => d.winner && !d.beforeTracking);
    if (first) setOpen(new Set([keyOf(first)]));
  }, [days]);

  const toggle = (k: string) => {
    touched.current = true;
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const pickShow = (v: string) => {
    setShow(v as Show);
    try {
      localStorage.setItem(SHOW_KEY, v);
    } catch {}
  };

  if (error) {
    return (
      <div style={{ marginTop: 18 }}>
        <ErrorBanner>
          <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 260px" }}>Couldn&apos;t load launches: {error}</span>
            <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={() => void load()}>
              Try again
            </Button>
          </span>
        </ErrorBanner>
      </div>
    );
  }
  if (!data) return <Loading />;

  const inBrands = data.brands.filter((b) => brand === "all" || b.name === brand);
  const ads = days.reduce((n, d) => n + d.total, 0);
  const withWinner = days.filter((d) => d.winner).length;
  // A brand with no stopped ads on record is one the scrape has only seen live: say so instead of reading it as "nothing stopped".
  const onlyLive = inBrands.filter((b) => b.ended === 0 && days.some((d) => d.brand === b.name));

  return (
    <>
      <H2
        right={
          days.length ? (
            <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
              {num(ads)} ads on {num(days.length)} days, {num(withWinner)} with a winner
            </span>
          ) : null
        }
      >
        Launch days, last {data.windowDays} days
      </H2>

      {!days.length ? (
        <Empty title="No launches in this window">Ads show here by the day they started, once the scrape has seen them.</Empty>
      ) : (
        <>
          <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto", marginBottom: 12 }}>
            <Segmented
              size="sm"
              value={show}
              onChange={pickShow}
              options={[
                { value: "all", label: "All launch days" },
                { value: "winners", label: `With a winner (${withWinner})` },
              ]}
            />
          </div>
          {onlyLive.map((b) => (
            <p key={b.name} style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)", margin: "0 0 12px", maxWidth: 760 }}>
              {b.name}: tracking began {shortDay(b.trackedSince)} and the scrape has only seen its live ads so far, so its launch days show the ads that survived, not the ones that stopped.
            </p>
          ))}
          {!shown.length ? (
            <Empty title="No launch day has a single winner yet">A winner needs one ad to outlast every other ad launched the same day.</Empty>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {shown.map((d) => {
                const k = keyOf(d);
                return (
                  <DayRow
                    key={k}
                    day={d}
                    showBrand={brand === "all"}
                    // The brand's note above already says it; don't repeat it on every day.
                    markTracking={d.beforeTracking && !onlyLive.some((b) => b.name === d.brand)}
                    expanded={open.has(k)}
                    allRows={full.has(k)}
                    onToggle={() => toggle(k)}
                    onShowAll={() => setFull((cur) => new Set(cur).add(k))}
                    onOpen={(ad) => onOpen(ad, d.entries.map((e) => e.ad))}
                    isMobile={isMobile}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <About>
        <p style={{ margin: 0 }}>
          Every ad each brand started in the last {data.windowDays} days, stopped ones included, grouped by the day it started. A brand that launches a batch on one day and keeps one or two running is testing creatives; the survivors are what it chose to keep paying for.
        </p>
        <p style={{ margin: 0 }}>
          Run length is Meta&apos;s own start and end dates from the Ad Library, in whole days, so &ldquo;under a day&rdquo; means it stopped the day it started. Each bar is measured against the days since launch: a full bar is still running, a short one stopped early. Meta&apos;s list of active ads keeps an ad for about two days after its end date, so Foreplay can still count an ad as running that has stopped here, and its run lengths come out a day or two longer.
        </p>
        <p style={{ margin: 0 }}>
          The winner is the one ad that ran longer than every other ad launched that day. When two or more tie for longest, or the whole batch is still running, the day has no winner yet. Days launched before a brand&apos;s tracking began are marked, because ads that stopped before the scrape first looked may be missing.
        </p>
      </About>
    </>
  );
}

function Loading() {
  return (
    <div aria-busy="true" style={{ marginTop: 28, display: "grid", gap: 8 }}>
      <div style={{ height: 15, width: 220, borderRadius: 4, background: "var(--bg-2)", marginBottom: 8 }} />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ height: 50, borderRadius: 12, background: "var(--bg-2)" }} />
      ))}
    </div>
  );
}

function DayRow({
  day: d,
  showBrand,
  markTracking,
  expanded,
  allRows,
  onToggle,
  onShowAll,
  onOpen,
  isMobile,
}: {
  day: LaunchDay;
  showBrand: boolean;
  markTracking: boolean;
  expanded: boolean;
  allRows: boolean;
  onToggle: () => void;
  onShowAll: () => void;
  onOpen: (ad: AdView) => void;
  isMobile: boolean;
}) {
  const panelId = `launch-${d.brand}-${d.day}`.replace(/\W+/g, "-");
  const verdict = d.winner ? (
    <span style={{ color: "var(--success-text)", fontWeight: 500 }}>Winner ran {runText(d.winner.days)}</span>
  ) : d.total > 1 && d.running === 0 && d.atLongest > 1 ? (
    // Survivors tying at the top already read in the running count; a tie is news only once all have stopped.
    <span style={{ color: "var(--ink-3)" }}>
      {d.atLongest} tied at {runText(d.longest)}
    </span>
  ) : null;
  const rows = allRows ? d.entries : d.entries.slice(0, FIRST_ROWS);
  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)", minWidth: 0 }}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="cad-focus"
        style={{
          all: "unset",
          boxSizing: "border-box",
          cursor: "pointer",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: isMobile ? "12px 12px" : "13px 16px",
          borderRadius: 12,
        }}
      >
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 14, rowGap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ font: "600 14px var(--font-ui)", color: "var(--ink)", whiteSpace: "nowrap" }}>
            {shortDay(d.day)}
            {showBrand && <span style={{ fontWeight: 500, color: "var(--ink-2)" }}> · {d.brand}</span>}
          </span>
          <span style={{ font: "400 13px var(--font-ui)", color: d.running ? "var(--ink)" : "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
            {runningText(d)[0].toUpperCase() + runningText(d).slice(1)}
          </span>
          {verdict && <span style={{ font: "400 13px var(--font-ui)", fontVariantNumeric: "tabular-nums" }}>{verdict}</span>}
          {markTracking && <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>Before tracking began</span>}
        </span>
        <span aria-hidden style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 160ms ease", color: "var(--ink-3)", flex: "none" }}>
          <Icons.ChevronDown size={16} />
        </span>
      </button>
      {expanded && (
        <div id={panelId} style={{ padding: isMobile ? "0 12px 12px" : "0 16px 14px", display: "grid", gap: 4 }}>
          {rows.map((e) => (
            <RunRow key={e.ad.id} entry={e} isMobile={isMobile} onOpen={onOpen} />
          ))}
          {rows.length < d.entries.length && (
            <button onClick={onShowAll} className="cad-focus" style={{ all: "unset", cursor: "pointer", color: "var(--link)", font: "500 13px var(--font-ui)", padding: "8px 0 0", width: "fit-content", borderRadius: 4 }}>
              Show all {num(d.entries.length)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function RunRow({ entry: e, isMobile, onOpen }: { entry: LaunchEntry; isMobile: boolean; onOpen: (ad: AdView) => void }) {
  const headline = adHeadline(e.ad);
  const label = `${e.winner ? "Winner, " : ""}${e.live ? `still running, ${runText(e.days)}` : `ran ${runText(e.days)}`}`;
  const fill = e.winner ? "var(--success)" : e.live ? "var(--accent)" : "var(--chart-bar)";
  // A stopped-the-same-day ad still gets a sliver, so the row never reads as empty.
  const width = `${Math.max(e.share * 100, 1.5)}%`;
  return (
    <button
      onClick={() => onOpen(e.ad)}
      aria-label={`${label}: ${headline}`}
      title={headline}
      className="cad-focus"
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: isMobile ? "28px minmax(0, 1fr)" : "32px minmax(0, 1fr) minmax(0, 260px)",
        alignItems: "center",
        gap: isMobile ? 10 : 14,
        padding: "4px 4px",
        borderRadius: 8,
      }}
      onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg)")}
      onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
    >
      <Thumb ad={e.ad} size={isMobile ? 28 : 32} />
      <span style={{ display: "block", minWidth: 0 }}>
        <span style={{ display: "block", position: "relative", height: 8, borderRadius: 4, background: "var(--bg-2)", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, width, background: fill, borderRadius: 4, opacity: e.live || e.winner ? 1 : 0.75 }} />
        </span>
        <span style={{ display: "flex", gap: 8, marginTop: 5, font: "400 12px var(--font-ui)", fontVariantNumeric: "tabular-nums", color: "var(--ink-2)", minWidth: 0 }}>
          <span style={{ whiteSpace: "nowrap", color: e.winner ? "var(--success-text)" : e.live ? "var(--ink)" : "var(--ink-2)", fontWeight: e.winner ? 600 : 400 }}>
            {e.winner ? `Winner · ${runText(e.days)}` : e.live ? `Still running · ${runText(e.days)}` : runText(e.days)}
          </span>
          {isMobile && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-3)" }}>{e.ad.identity}</span>}
        </span>
      </span>
      {!isMobile && (
        <span style={{ display: "block", minWidth: 0 }}>
          <span style={{ display: "block", font: "500 12.5px var(--font-ui)", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{headline}</span>
          <span style={{ display: "block", font: "400 12px var(--font-ui)", color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.ad.identity}</span>
        </span>
      )}
    </button>
  );
}
