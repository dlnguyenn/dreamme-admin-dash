"use client";

/**
 * Where signups say they heard about us — today, or any of the last 30 days.
 *
 * The panel compares SHARE OF MIX rather than raw counts, and says which mode
 * it is in. Today is a partial day: at 3pm Eastern every count sits well below
 * a full-day average, so a count-vs-count read would show every source
 * collapsing, every afternoon (the false alarm migration 0060 killed on the
 * trials tile). On 2026-08-07 that distinction was the whole story: TikTok's
 * 35 looked catastrophic next to an 85.7/day average, while its share — 24.8%
 * vs 34.5% — showed a real but much smaller dip, and Facebook, equally "down"
 * on count, was flat. A stepped-back day IS complete, so its counts are
 * honest; the header says so rather than letting the meaning shift silently.
 *
 * Each day is compared against the 7 days immediately before IT, never a
 * trailing week from today. See attributionForDay in src/lib/overview.ts.
 *
 * History loads from /api/overview/attribution once after first paint —
 * /api/overview is polled on a timer and must not carry ~11,000 raw rows.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import type { AttributionSection, AttributionSeries } from "@/lib/overview";
import { Card, DeltaChip, SectionHeader } from "../porcelain";
import { EmptyState, fmtNum, fmtPct, referralColor, referralLabel } from "./shared";

/** Below this, a share move is noise rather than a signal worth a chip. */
const MEANINGFUL_SHARE_DELTA = 1.5;

/**
 * The series costs ~11,000 rows server-side, so it is cached per module and
 * shared by every caller for CACHE_TTL_MS.
 *
 * This is not just an optimisation: React StrictMode double-invokes effects
 * in development, and any remount (tab away and back) would otherwise pull
 * the whole window again. Caching the PROMISE — not just the result — also
 * collapses two concurrent mounts into one request.
 *
 * A TTL rather than forever, so the series' own "today" entry keeps up as the
 * day accumulates and rolls over at Eastern midnight.
 */
const CACHE_TTL_MS = 5 * 60_000;
let seriesCache: { at: number; promise: Promise<AttributionSeries | null> } | null = null;

function loadSeries(): Promise<AttributionSeries | null> {
  if (seriesCache && Date.now() - seriesCache.at < CACHE_TTL_MS) {
    return seriesCache.promise;
  }
  const promise = (async () => {
    try {
      const res = await fetch("/api/overview/attribution", { cache: "no-store" });
      const body = (await res.json()) as
        | ({ ok: true } & AttributionSeries)
        | { ok: false; error: string };
      return body.ok ? body : null;
    } catch {
      return null; // history unavailable — today still renders
    }
  })();
  seriesCache = { at: Date.now(), promise };
  return promise;
}

/**
 * Compact per-row trend. Not porcelain's Sparkline: that one is a filled area
 * sized for a hero card and takes semantic Family colors, where these need to
 * be narrow, unfilled, and tinted to match the row's source swatch.
 *
 * Nulls are gaps (a day with no signups), so the line breaks rather than
 * diving to zero and inventing a crash.
 */
function ShareTrend({
  values,
  color,
  width = 64,
  height = 16,
}: {
  values: (number | null)[];
  color: string;
  width?: number;
  height?: number;
}) {
  const present = values.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const mx = Math.max(...present);
  const mn = Math.min(...present);
  const rg = mx - mn || 1;
  const step = width / Math.max(1, values.length - 1);

  // Split into runs of consecutive non-null points; each run is its own line.
  const runs: string[][] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    const y = height - 2 - ((v - mn) / rg) * (height - 4);
    run.push(`${(i * step).toFixed(1)},${y.toFixed(1)}`);
  });
  if (run.length) runs.push(run);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block", flex: "none", overflow: "visible" }}
      aria-hidden="true"
    >
      {runs.map((r, i) =>
        r.length === 1 ? (
          <circle key={i} cx={r[0].split(",")[0]} cy={r[0].split(",")[1]} r={1.2} fill={color} />
        ) : (
          <polyline
            key={i}
            points={r.join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 24,
        height: 24,
        borderRadius: 7,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        color: disabled ? "var(--ink-4)" : "var(--ink-2)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        font: "600 13px var(--font-ui)",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      {children}
    </button>
  );
}

/** "Today" / "Yesterday" / "Wed Aug 5" — parsed as a plain calendar date. */
function dayLabel(day: string, todayIso: string, offset: number): string {
  if (day === todayIso) return "Today";
  if (offset === 1) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function AttributionPanel({
  attribution,
}: {
  attribution: AttributionSection | null;
}) {
  const isMobile = useIsMobile();
  const [series, setSeries] = React.useState<AttributionSeries | null>(null);
  /** 0 = today, 1 = yesterday, … */
  const [offset, setOffset] = React.useState(0);

  // After first paint, not during it. Failure is silent: the panel keeps
  // working on today's data from the main payload, it just can't step back.
  React.useEffect(() => {
    let alive = true;
    loadSeries().then((s) => {
      if (alive && s) setSeries(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const days = series?.days ?? [];
  const todayIso = days.length ? days[days.length - 1] : null;
  const selectedDay = todayIso ? days[days.length - 1 - offset] : null;
  const viewing =
    (selectedDay && series?.byDay[selectedDay]) || (offset === 0 ? attribution : null);
  const isToday = offset === 0;

  if (!viewing) {
    return (
      <>
        <SectionHeader family="info" icon="Flag" title="Where they heard about us" />
        <Card>
          <EmptyState title="Couldn't load attribution">
            The overview API returned an error for this section.
          </EmptyState>
        </Card>
      </>
    );
  }

  const canStepBack = series != null && offset < days.length - 1;
  const canStepForward = offset > 0;
  const maxShare = Math.max(
    1,
    ...viewing.rows.map((r) => Math.max(r.todaySharePct ?? 0, r.priorSharePct ?? 0)),
  );

  return (
    <>
      <SectionHeader
        family="info"
        icon="Flag"
        title="Where they heard about us"
        meta={
          isMobile
            ? isToday
              ? "self-reported · ET"
              : "self-reported · complete day"
            : isToday
              ? "self-reported at onboarding · ET day · today is partial, so compare share"
              : "self-reported at onboarding · complete ET day · vs the 7 days before it"
        }
        right={
          series ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                font: "500 12.5px var(--font-ui)",
                color: "var(--ink-2)",
              }}
            >
              <StepButton
                label="Previous day"
                onClick={() => setOffset((o) => o + 1)}
                disabled={!canStepBack}
              >
                ‹
              </StepButton>
              <span
                style={{
                  minWidth: 86,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {selectedDay && todayIso
                  ? dayLabel(selectedDay, todayIso, offset)
                  : "Today"}
              </span>
              <StepButton
                label="Next day"
                onClick={() => setOffset((o) => Math.max(0, o - 1))}
                disabled={!canStepForward}
              >
                ›
              </StepButton>
            </span>
          ) : undefined
        }
      />
      <Card pad={isMobile ? "16px 16px" : "20px 22px"}>
        {viewing.rows.length === 0 ? (
          <EmptyState title={isToday ? "No signups yet today" : "No signups that day"}>
            {isToday
              ? "Nobody has answered the onboarding question since Eastern midnight."
              : "No answered signups were recorded on this day."}
          </EmptyState>
        ) : (
          <>
            <div style={{ display: "grid", gap: isMobile ? 12 : 10 }}>
              {viewing.rows.map((r) => {
                const delta =
                  r.todaySharePct != null && r.priorSharePct != null
                    ? Math.round((r.todaySharePct - r.priorSharePct) * 10) / 10
                    : null;
                const show = delta != null && Math.abs(delta) >= MEANINGFUL_SHARE_DELTA;
                const history = series?.shareHistory[r.source];
                return (
                  <div
                    key={r.source}
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile
                        ? "1fr auto"
                        : "150px 58px 1fr 72px 132px",
                      alignItems: "center",
                      gap: isMobile ? 6 : 12,
                      rowGap: 4,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        font: "500 13px var(--font-ui)",
                        color: "var(--ink)",
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 3,
                          background: referralColor(r.source),
                          flex: "none",
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {referralLabel(r.source)}
                      </span>
                    </span>

                    <span
                      style={{
                        font: "650 14px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ink)",
                        textAlign: isMobile ? "right" : "left",
                      }}
                    >
                      {fmtNum(r.today)}
                    </span>

                    {/* Share bar: the day filled, its baseline as a tick. */}
                    <div
                      style={{
                        gridColumn: isMobile ? "1 / -1" : undefined,
                        position: "relative",
                        height: 8,
                        borderRadius: 999,
                        background: "var(--surface-2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${((r.todaySharePct ?? 0) / maxShare) * 100}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: referralColor(r.source),
                        }}
                      />
                      {r.priorSharePct != null && (
                        <span
                          title="7-day average share"
                          style={{
                            position: "absolute",
                            top: -1,
                            bottom: -1,
                            left: `${(r.priorSharePct / maxShare) * 100}%`,
                            width: 2,
                            background: "var(--ink-3)",
                            opacity: 0.75,
                          }}
                        />
                      )}
                    </div>

                    {!isMobile && (
                      <span
                        title={`${referralLabel(r.source)} share, last ${days.length} days`}
                        style={{ display: "inline-flex", justifyContent: "flex-end" }}
                      >
                        {history && (
                          <ShareTrend values={history} color={referralColor(r.source)} />
                        )}
                      </span>
                    )}

                    <span
                      style={{
                        gridColumn: isMobile ? "1 / -1" : undefined,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        font: "400 11.5px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ink-4)",
                        whiteSpace: "nowrap",
                        justifyContent: isMobile ? "flex-start" : "flex-end",
                      }}
                    >
                      {fmtPct(r.todaySharePct)} vs {fmtPct(r.priorSharePct)}
                      {show && (
                        <DeltaChip family={delta > 0 ? "success" : "neutral"} size={11}>
                          {/* One decimal always: "+4" next to "+1.5" reads as
                              a different unit at a glance. */}
                          {`${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                        </DeltaChip>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid var(--line)",
                font: "400 11.5px var(--font-ui)",
                color: "var(--ink-4)",
              }}
            >
              {fmtNum(viewing.todayTotal)} answered {isToday ? "today" : "that day"} ·{" "}
              {fmtNum(viewing.prior7dTotal)} over the prior 7 days
              {viewing.unansweredToday > 0 && (
                <> · {fmtNum(viewing.unansweredToday)} skipped the question</>
              )}
              {viewing.coveragePct != null && (
                <> · {fmtPct(viewing.coveragePct, 0)} coverage</>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
