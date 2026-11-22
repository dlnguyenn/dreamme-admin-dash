"use client";

/**
 * The Ads view: every live competitor ad as cards (creative first) or as a
 * ranked list, filtered by set (top ranked, breakouts, long-running, new this
 * week), account type, format, one creator or store page, and text.
 */

import * as React from "react";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { Segmented } from "../porcelain";
import { SIGNALS, type AdView } from "@/lib/competitor-ads-tab/logic";
import { SET_LABEL, filterAds, setCounts, type AdFilter, type AdSet, type AdSort, type FormatFilter, type RunsAs } from "@/lib/competitor-ads-tab/filters";
import { About, AdCard, AdCell, CardGrid, ClearableFilter, Empty, MoveText, Select, TableBox, cell, controlStyle, head, left, num, rankText } from "./parts";

export type Layout = "cards" | "list";
const PAGE = 24;

const SETS: AdSet[] = ["ranked", "rising", "lasting", "new", "all"];
const SORTS: { value: AdSort; label: string }[] = [
  { value: "rank", label: "Sort: delivery rank" },
  { value: "days", label: "Sort: longest running" },
  { value: "newest", label: "Sort: newest" },
  { value: "copies", label: "Sort: most copies" },
];

export function AdsView({
  all,
  shown,
  filter,
  onFilter,
  sort,
  onSort,
  layout,
  onLayout,
  savedIds,
  onOpen,
  onToggleSave,
  isMobile,
}: {
  /** Every live ad (for the set counts). */
  all: AdView[];
  /** Filtered and sorted. */
  shown: AdView[];
  filter: AdFilter;
  onFilter: (f: Partial<AdFilter>) => void;
  sort: AdSort;
  onSort: (s: AdSort) => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  savedIds: Set<string>;
  onOpen: (a: AdView) => void;
  onToggleSave: (a: AdView) => void;
  isMobile: boolean;
}) {
  const [limit, setLimit] = React.useState(PAGE);
  // Counts follow every other filter, so each set says what choosing it would show.
  const counts = React.useMemo(() => setCounts(filterAds(all, { ...filter, set: "all" }), "all"), [all, filter]);
  // A new filter starts from the first page again.
  const key = JSON.stringify([filter, sort]);
  React.useEffect(() => setLimit(PAGE), [key]);
  const page = shown.slice(0, limit);
  const showBrand = filter.brand === "all";

  return (
    <>
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented
            size="sm"
            value={filter.set}
            onChange={(v) => onFilter({ set: v as AdSet })}
            options={SETS.map((s) => ({
              value: s,
              label: (
                <span style={{ whiteSpace: "nowrap" }}>
                  {SET_LABEL[s]} <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{counts[s]}</span>
                </span>
              ),
            }))}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={{ position: "relative", flex: isMobile ? "1 1 100%" : "0 1 260px", minWidth: 0 }}>
            <span style={{ position: "absolute", left: 10, top: 8, color: "var(--ink-3)", pointerEvents: "none" }}>
              <Icons.Search size={17} />
            </span>
            <input
              type="search"
              value={filter.query}
              onChange={(e) => onFilter({ query: e.target.value })}
              placeholder="Search hooks, copy, accounts"
              aria-label="Search ads"
              className="cad-focus"
              style={{ ...controlStyle, width: "100%", paddingLeft: 34 }}
            />
          </label>
          <div className={isMobile ? "mobile-hscroll" : undefined} style={isMobile ? { display: "flex", gap: 8, overflowX: "auto", maxWidth: "100%", flexWrap: "nowrap" } : { display: "contents" }}>
          <Select<RunsAs>
            label="Runs as"
            value={filter.runsAs}
            onChange={(v) => onFilter({ runsAs: v })}
            options={[
              { value: "all", label: "Any account" },
              { value: "creators", label: "Creator accounts" },
              { value: "brand", label: "Brand page" },
            ]}
          />
          <Select<FormatFilter>
            label="Format"
            value={filter.format}
            onChange={(v) => onFilter({ format: v })}
            options={[
              { value: "all", label: "Any format" },
              { value: "video", label: "Video" },
              { value: "image", label: "Image" },
              { value: "dco", label: "DCO" },
            ]}
          />
          <Select<AdSort> label="Sort" value={sort} onChange={onSort} options={SORTS} />
          {filter.identity && <ClearableFilter label={`Account: ${filter.identity}`} onClear={() => onFilter({ identity: null })} />}
          {filter.cpp && <ClearableFilter label={`Store page ${filter.cpp.slice(0, 8)}`} onClear={() => onFilter({ cpp: null })} />}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, flex: "none" }}>
            {!isMobile && (
              <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {num(shown.length)} {shown.length === 1 ? "creative" : "creatives"}
              </span>
            )}
            <Segmented
              size="sm"
              value={layout}
              onChange={(v) => onLayout(v as Layout)}
              options={[
                { value: "cards", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icons.Grid size={15} />Cards</span> },
                { value: "list", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icons.Menu size={15} />List</span> },
              ]}
            />
          </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {!shown.length ? (
          <Empty title="No ads match these filters">{filter.set === "rising" || filter.set === "lasting" ? "Breakouts need a week of daily ranks and long-running ads 10+ days, so a newly tracked brand has none yet." : "Try All live, or clear the search."}</Empty>
        ) : layout === "cards" ? (
          <CardGrid isMobile={isMobile}>
            {page.map((a) => (
              <AdCard key={a.id} ad={a} showBrand={showBrand} saved={savedIds.has(a.adArchiveId)} onOpen={onOpen} onToggleSave={onToggleSave} />
            ))}
          </CardGrid>
        ) : (
          <AdList ads={page} showBrand={showBrand} onOpen={onOpen} isMobile={isMobile} />
        )}
        {shown.length > limit && (
          <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}>
            <Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more of {num(shown.length - limit)}
            </Button>
          </div>
        )}
      </div>

      <About>
        <p style={{ margin: 0 }}>
          Each card is one creative. Brands often run the same video as several ads; the card shows the best-ranked copy and how many copies are live.
        </p>
        <p style={{ margin: 0 }}>
          Rank is the Ad Library&apos;s impressions order, snapshotted every morning by Outlier. It counts lifetime impressions, so older ads drift up; a high rank on a young ad is the strong signal.
        </p>
        <p style={{ margin: 0 }}>
          Breakouts: top 50 and at least 20 places higher than a week ago, or Outlier&apos;s breakout label (top 50, live 14 days or less). Long-running: live 30+ days and in the top 50 on 80% of the last 14 days, or top 5 now and a week ago.
        </p>
        <p style={{ margin: 0 }}>
          Signals, in each ad&apos;s detail, count how many agree: top {SIGNALS.topRank} today, top {SIGNALS.topRank} on {SIGNALS.persistDays}+ of the last 14 days, live {SIGNALS.longRunDays}+ days, {SIGNALS.copies}+ live copies of the creative, EU reach in the brand&apos;s top quarter. &ldquo;No creative captured yet&rdquo; is a live ad whose video or image wasn&apos;t in the scrape, usually because it started the day before.
        </p>
      </About>
    </>
  );
}

/** The numbers side by side: the list layout. */
export function AdList({ ads, showBrand, onOpen, isMobile }: { ads: AdView[]; showBrand: boolean; onOpen: (a: AdView) => void; isMobile: boolean }) {
  if (isMobile) {
    return (
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ads.map((a) => (
          <li key={a.id} style={{ borderTop: "1px solid var(--line)" }}>
            <button onClick={() => onOpen(a)} className="cad-focus" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "10px 0", boxSizing: "border-box" }}>
              <AdCell ad={a} showBrand={showBrand} />
              <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 6, font: "400 12px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>{rankText(a.rank.now)}</span>
                <MoveText ad={a} />
                <span>{num(a.runDays)} days live</span>
                <span>{a.copies} {a.copies === 1 ? "copy" : "copies"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <TableBox minWidth={980}>
      <thead>
        <tr>
          <th scope="col" style={head}>Rank</th>
          <th scope="col" style={{ ...head, ...left, paddingLeft: 6 }}>Ad</th>
          <th scope="col" style={head}>A week ago</th>
          <th scope="col" style={head}>2 weeks ago</th>
          <th scope="col" style={head}>Days in top 20</th>
          <th scope="col" style={head}>Days live</th>
          <th scope="col" style={head}>Copies</th>
          <th scope="col" style={head}>Signals</th>
        </tr>
      </thead>
      <tbody>
        {ads.map((a) => (
          <tr
            key={a.id}
            tabIndex={0}
            className="cad-focus"
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
                <MoveText ad={a} />
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
  );
}
