"use client";

/**
 * 30-day organic reach: cumulative total split by publishing source, plus the
 * daily column chart.
 *
 * The chart deliberately states which series it is drawing. "Views gained per
 * day" and "views on content published that day" are different measurements
 * and only one of them is available before the snapshot cron has 30 days of
 * history — presenting the proxy as if it were the real thing would be a lie
 * you could act on. See src/lib/socialViews.ts.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import type { ViewsSection } from "@/lib/overview";
import { Card, SectionHeader } from "../porcelain";
import {
  EmptyState,
  LegendDot,
  fmtCompact,
  fmtNum,
  shortDay,
  sourceColor,
  sourceLabel,
} from "./shared";

const CHART_HEIGHT = 132;
/** Gap between stacked segments, so adjacent fills read as separate marks. */
const SEGMENT_GAP = 2;

export function ViewsPanel({ views }: { views: ViewsSection | null }) {
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState<number | null>(null);

  if (!views) {
    return (
      <>
        <SectionHeader family="info" icon="Chart" title="Organic views" />
        <Card>
          <EmptyState title="Couldn't load view data">
            The overview API returned an error for this section.
          </EmptyState>
        </Card>
      </>
    );
  }

  const sources = views.bySource.filter((b) => b.posts > 0);
  const legendSources = sources.length > 0 ? sources.map((s) => s.source) : [];
  const max = Math.max(1, ...views.daily.map((d) => d.total));

  return (
    <>
      <SectionHeader
        family="info"
        icon="Chart"
        title="Organic views"
        meta="last 30 days"
        right={
          legendSources.length > 1 ? (
            <span style={{ display: "inline-flex", gap: 14 }}>
              {legendSources.map((s) => (
                <LegendDot key={s} source={s} />
              ))}
            </span>
          ) : undefined
        }
      />

      {!views.configured ? (
        <Card>
          <EmptyState title="Waiting for the first view sync">
            {views.accounts.active} accounts are registered across{" "}
            {views.platforms.join(", ") || "no platforms"}, but no posts have been
            synced yet. Views land once the Doublespeed and Sideshift API
            credentials are in Vercel and <code>/api/cron/sync-post-views</code>{" "}
            has run.
          </EmptyState>
        </Card>
      ) : (
        <Card pad={isMobile ? "16px 16px" : "20px 22px"}>
          {/* Cumulative headline + per-source split */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: isMobile ? 16 : 28,
              marginBottom: 18,
            }}
          >
            <div>
              <div
                style={{
                  font: "650 10.5px var(--font-ui)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 6,
                }}
              >
                Cumulative, 30 days
              </div>
              <div
                style={{
                  font: `700 ${isMobile ? 30 : 34}px/1 var(--font-ui)`,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.01em",
                  color: "var(--ink)",
                }}
              >
                {fmtNum(views.cumulative)}
              </div>
            </div>

            {sources.map((s) => (
              <div key={s.source}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    font: "650 10.5px var(--font-ui)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 3,
                      background: sourceColor(s.source),
                      flex: "none",
                    }}
                  />
                  {sourceLabel(s.source)}
                </div>
                <div
                  style={{
                    font: "700 22px/1 var(--font-ui)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink)",
                  }}
                >
                  {fmtNum(s.views)}
                </div>
                <div
                  style={{
                    font: "400 11.5px var(--font-ui)",
                    color: "var(--ink-4)",
                    marginTop: 4,
                  }}
                >
                  {s.posts} posts
                </div>
              </div>
            ))}
          </div>

          <DailyChart
            daily={views.daily}
            max={max}
            hover={hover}
            setHover={setHover}
          />

          <div
            style={{
              marginTop: 12,
              font: "400 12px/1.5 var(--font-ui)",
              color: "var(--ink-4)",
            }}
          >
            {views.mode === "gained" ? "Views gained per day. " : "Views by publish date. "}
            {views.modeReason}
          </div>
        </Card>
      )}
    </>
  );
}

function DailyChart({
  daily,
  max,
  hover,
  setHover,
}: {
  daily: ViewsSection["daily"];
  max: number;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const active = hover != null ? daily[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Tooltip sits above the plot rather than following the cursor, so it
          can't clip out of the card on the leftmost or rightmost column. */}
      <div style={{ height: 34, marginBottom: 4 }}>
        {active && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "6px 11px",
              borderRadius: 10,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              font: "500 12px var(--font-ui)",
              color: "var(--ink-2)",
            }}
          >
            <span style={{ color: "var(--ink)", fontWeight: 650 }}>
              {shortDay(active.date)}
            </span>
            {Object.entries(active.bySource)
              .filter(([, v]) => v > 0)
              .map(([source, v]) => (
                <span
                  key={source}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: sourceColor(source),
                    }}
                  />
                  {sourceLabel(source)} {fmtNum(v)}
                </span>
              ))}
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                color: "var(--ink)",
                fontWeight: 650,
              }}
            >
              {fmtNum(active.total)} total
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: CHART_HEIGHT,
          borderBottom: "1px solid var(--chart-grid)",
        }}
        onMouseLeave={() => setHover(null)}
      >
        {daily.map((d, i) => {
          const entries = Object.entries(d.bySource).filter(([, v]) => v > 0);
          const isHover = hover === i;
          return (
            <div
              key={d.date}
              onMouseEnter={() => setHover(i)}
              title={`${shortDay(d.date)} · ${fmtNum(d.total)} views`}
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                gap: SEGMENT_GAP,
                cursor: "default",
                // Whole-column hit target, wider than the mark itself.
                background: isHover ? "var(--surface-2)" : "transparent",
                borderRadius: "6px 6px 0 0",
                transition: "background 120ms ease",
              }}
            >
              {entries.length === 0 ? (
                <div
                  style={{
                    height: 2,
                    background: "var(--line-2)",
                    borderRadius: 2,
                  }}
                />
              ) : (
                entries.map(([source, v], si) => (
                  <div
                    key={source}
                    style={{
                      height: Math.max(2, (v / max) * (CHART_HEIGHT - 6)),
                      background: sourceColor(source),
                      // 4px rounded data-end on the topmost segment only; the
                      // rest stay square so the stack reads as one column.
                      borderRadius: si === 0 ? "4px 4px 0 0" : 0,
                      opacity: hover == null || isHover ? 1 : 0.45,
                      transition: "opacity 120ms ease",
                    }}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* Sparse ticks — a label on every one of 30 columns is unreadable. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 7,
          font: "400 11px var(--font-ui)",
          color: "var(--ink-4)",
        }}
      >
        <span>{daily.length > 0 ? shortDay(daily[0].date) : ""}</span>
        <span>
          {daily.length > 2 ? shortDay(daily[Math.floor(daily.length / 2)].date) : ""}
        </span>
        <span>
          {daily.length > 1 ? shortDay(daily[daily.length - 1].date) : ""}
        </span>
      </div>

      <div
        style={{
          marginTop: 4,
          font: "400 11px var(--font-ui)",
          color: "var(--ink-4)",
          textAlign: "right",
        }}
      >
        peak {fmtCompact(max)}
      </div>
    </div>
  );
}
