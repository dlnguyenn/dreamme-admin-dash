"use client";

/**
 * Where today's signups say they came from, against the prior 7 complete days.
 *
 * The panel compares SHARE OF MIX rather than raw counts, and says so. Today
 * is always a partial day — at 3pm Eastern every count sits well below a
 * full-day average — so a count-vs-count read would show every source
 * collapsing, every afternoon. On 2026-08-07 that distinction was the whole
 * story: TikTok's 35 looked catastrophic next to an 85.7/day average, but its
 * share (25.0% vs 34.5%) showed a real, much smaller dip, while Facebook —
 * equally "down" on count — was flat on share.
 *
 * Counts are still shown, because share alone can't tell you whether a quiet
 * day is quiet. See buildAttribution in src/lib/overview.ts.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import type { AttributionSection } from "@/lib/overview";
import { Card, DeltaChip, SectionHeader } from "../porcelain";
import { EmptyState, fmtNum, fmtPct, referralColor, referralLabel } from "./shared";

/** Below this, a share move is noise rather than a signal worth a chip. */
const MEANINGFUL_SHARE_DELTA = 1.5;

export function AttributionPanel({
  attribution,
}: {
  attribution: AttributionSection | null;
}) {
  const isMobile = useIsMobile();

  if (!attribution) {
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

  const { rows } = attribution;
  const maxShare = Math.max(
    1,
    ...rows.map((r) => Math.max(r.todaySharePct ?? 0, r.priorSharePct ?? 0)),
  );

  return (
    <>
      <SectionHeader
        family="info"
        icon="Flag"
        title="Where they heard about us"
        meta={
          isMobile
            ? "self-reported · ET"
            : "self-reported at onboarding · ET day · today is partial, so compare share"
        }
      />
      <Card pad={isMobile ? "16px 16px" : "20px 22px"}>
        {rows.length === 0 ? (
          <EmptyState title="No signups yet today">
            Nobody has answered the onboarding question since Eastern midnight.
          </EmptyState>
        ) : (
          <>
            <div style={{ display: "grid", gap: isMobile ? 12 : 10 }}>
              {rows.map((r) => {
                const delta =
                  r.todaySharePct != null && r.priorSharePct != null
                    ? Math.round((r.todaySharePct - r.priorSharePct) * 10) / 10
                    : null;
                const show = delta != null && Math.abs(delta) >= MEANINGFUL_SHARE_DELTA;
                return (
                  <div
                    key={r.source}
                    style={{
                      display: "grid",
                      // Label | today's count | share bar | 7d baseline
                      gridTemplateColumns: isMobile
                        ? "1fr auto"
                        : "150px 58px 1fr 132px",
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

                    {/* Share bar: today filled, the 7d baseline as a tick. */}
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
              {fmtNum(attribution.todayTotal)} answered today ·{" "}
              {fmtNum(attribution.prior7dTotal)} over the prior 7 days
              {attribution.unansweredToday > 0 && (
                <> · {fmtNum(attribution.unansweredToday)} skipped the question</>
              )}
              {attribution.coveragePct != null && (
                <> · {fmtPct(attribution.coveragePct, 0)} coverage</>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
