"use client";

/**
 * Growth AI — the all-in-one paid-social command center for a consumer app:
 * Motion-style visual creative analytics + a Runneth-style AI marketing
 * brain, built on the data the dash already syncs (ad_insights_daily,
 * rc_account_metrics_daily, blended_marketing_efficiency).
 *
 * Three sub-views (SubtabNav pattern, persisted like Resources):
 *   Overview   — this week at a glance, shifts, top creative
 *   Creatives  — visual leaderboard with WoW deltas + attention metrics
 *   AI Analyst — chat with tool-use over live data + one-click weekly recap
 */

import * as React from "react";
import { PageHeader } from "./Shell";
import { useIsMobile } from "@/lib/useIsMobile";
import { useGrowthData } from "./growth/data";
import { GrowthOverview } from "./growth/GrowthOverview";
import { GrowthLeaderboard } from "./growth/GrowthLeaderboard";
import { GrowthAnalyst } from "./growth/GrowthAnalyst";

type Subtab = "overview" | "creatives" | "analyst";

const SUBTAB_KEY = "dreamme.growth.subtab";

const SUBTABS: Array<{ id: Subtab; label: string; short: string }> = [
  { id: "overview", label: "Overview", short: "Overview" },
  { id: "creatives", label: "Creatives", short: "Creatives" },
  { id: "analyst", label: "AI Analyst", short: "Analyst" },
];

export function GrowthAI() {
  const isMobile = useIsMobile();
  const data = useGrowthData();
  const [subtab, setSubtab] = React.useState<Subtab>("overview");
  const [prefill, setPrefill] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(SUBTAB_KEY);
      if (saved === "overview" || saved === "creatives" || saved === "analyst") {
        setSubtab(saved);
      }
    } catch {}
  }, []);

  const changeTab = (t: Subtab) => {
    setSubtab(t);
    try {
      localStorage.setItem(SUBTAB_KEY, t);
    } catch {}
  };

  // "✦ Analyze" buttons anywhere in the tab jump into the analyst with a
  // ready-to-send question.
  const onAsk = React.useCallback((prompt: string) => {
    setPrefill(prompt);
    setSubtab("analyst");
    try {
      localStorage.setItem(SUBTAB_KEY, "analyst");
    } catch {}
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Paid Social"
        title={<em>Growth AI</em>}
        subtitle="Your all-in-one paid-social command center: easy-to-read creative analytics plus an AI brain that reads the live numbers — built for consumer apps, not DTC."
        tint="color-mix(in oklab, var(--p-hailey) 45%, transparent)"
        actions={
          <button
            onClick={data.refresh}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink-2)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        }
      />

      {/* Segmented sub-nav (Resources SubtabNav pattern) */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          marginBottom: 24,
        }}
      >
        {SUBTABS.map((t) => {
          const active = subtab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => changeTab(t.id)}
              style={{
                padding: isMobile ? "7px 12px" : "8px 18px",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                borderRadius: 9,
                border: "none",
                background: active ? "var(--surface)" : "transparent",
                boxShadow: active ? "var(--shadow-sm)" : "none",
                color: active ? "var(--ink)" : "var(--ink-3)",
                cursor: "pointer",
                transition: "background 140ms ease, color 140ms ease",
              }}
            >
              {t.id === "analyst" && (
                <span style={{ marginRight: 6, fontSize: 12 }}>✦</span>
              )}
              {isMobile ? t.short : t.label}
            </button>
          );
        })}
      </div>

      {data.loading ? (
        <div style={{ padding: 80, textAlign: "center", color: "var(--ink-3)" }}>
          <div className="serif" style={{ fontSize: 24, fontStyle: "italic" }}>
            Warming up the machine…
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Pulling 8 weeks of ad + RevenueCat data.
          </div>
        </div>
      ) : subtab === "overview" ? (
        <GrowthOverview data={data} onAsk={onAsk} />
      ) : subtab === "creatives" ? (
        <GrowthLeaderboard data={data} onAsk={onAsk} />
      ) : (
        <GrowthAnalyst
          data={data}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(null)}
        />
      )}
    </>
  );
}
