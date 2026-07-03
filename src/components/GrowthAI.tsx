"use client";

/**
 * Growth AI — the all-in-one paid-social command center for a consumer app:
 * Motion-style visual creative analytics + a Runneth-style AI marketing
 * brain, built on the data the dash already syncs (ad_insights_daily,
 * rc_account_metrics_daily, blended_marketing_efficiency).
 *
 * Four sub-views (SubtabNav pattern, persisted like Resources):
 *   Overview   — this week at a glance, alerts, shifts, top creative
 *   Creatives  — visual leaderboard + launch sprints
 *   Insights   — AI-tag driven messaging themes + comparative breakdowns
 *   AI Analyst — chat with tool-use over live data + weekly recaps
 */

import * as React from "react";
import { PageHeader } from "./Shell";
import { useIsMobile } from "@/lib/useIsMobile";
import { useGrowthData } from "./growth/data";
import { GrowthOverview } from "./growth/GrowthOverview";
import { GrowthLeaderboard } from "./growth/GrowthLeaderboard";
import { GrowthLaunches } from "./growth/GrowthLaunches";
import { GrowthInsights } from "./growth/GrowthInsights";
import { GrowthInspo } from "./growth/GrowthInspo";
import { GrowthAnalyst } from "./growth/GrowthAnalyst";
import { AdDrawer } from "./growth/AdDrawer";
import { Skeleton } from "./growth/shared";

type Subtab = "overview" | "creatives" | "insights" | "inspo" | "analyst";
type CreativesView = "leaderboard" | "launches";

const SUBTAB_KEY = "dreamme.growth.subtab";
const CREATIVES_VIEW_KEY = "dreamme.growth.creativesView";

const SUBTABS: Array<{ id: Subtab; label: string; short: string }> = [
  { id: "overview", label: "Overview", short: "Overview" },
  { id: "creatives", label: "Creatives", short: "Creatives" },
  { id: "insights", label: "Insights", short: "Insights" },
  { id: "inspo", label: "Inspo", short: "Inspo" },
  { id: "analyst", label: "AI Analyst", short: "Analyst" },
];

export function GrowthAI() {
  const isMobile = useIsMobile();
  const data = useGrowthData();
  const [subtab, setSubtab] = React.useState<Subtab>("overview");
  const [creativesView, setCreativesView] = React.useState<CreativesView>("leaderboard");
  const [prefill, setPrefill] = React.useState<string | null>(null);
  const [selectedAdId, setSelectedAdId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(SUBTAB_KEY);
      if (
        saved === "overview" ||
        saved === "creatives" ||
        saved === "insights" ||
        saved === "inspo" ||
        saved === "analyst"
      ) {
        setSubtab(saved);
      }
      const view = localStorage.getItem(CREATIVES_VIEW_KEY);
      if (view === "leaderboard" || view === "launches") setCreativesView(view);
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

      {/* Segmented sub-nav (Resources SubtabNav pattern) — sticky so the
          nav survives long leaderboards/theme walls */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: "color-mix(in oklab, var(--bg) 80%, var(--surface))",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          marginBottom: 24,
          boxShadow: "var(--shadow-sm)",
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
        <LoadingSkeleton />
      ) : subtab === "overview" ? (
        <GrowthOverview data={data} onAsk={onAsk} onOpenAd={setSelectedAdId} />
      ) : subtab === "creatives" ? (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {(
              [
                { id: "leaderboard", label: "Leaderboard" },
                { id: "launches", label: "New launches" },
              ] as Array<{ id: CreativesView; label: string }>
            ).map((v) => {
              const active = creativesView === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setCreativesView(v.id);
                    try {
                      localStorage.setItem(CREATIVES_VIEW_KEY, v.id);
                    } catch {}
                  }}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12.5,
                    fontWeight: 500,
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active ? "var(--ink)" : "var(--line)",
                    background: active ? "var(--ink)" : "var(--surface)",
                    color: active ? "var(--surface)" : "var(--ink-2)",
                    cursor: "pointer",
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
          {creativesView === "leaderboard" ? (
            <GrowthLeaderboard data={data} onAsk={onAsk} onOpenAd={setSelectedAdId} />
          ) : (
            <GrowthLaunches data={data} onOpenAd={setSelectedAdId} />
          )}
        </>
      ) : subtab === "insights" ? (
        <GrowthInsights data={data} onAsk={onAsk} onOpenAd={setSelectedAdId} />
      ) : subtab === "inspo" ? (
        <GrowthInspo onAsk={onAsk} />
      ) : (
        <GrowthAnalyst
          data={data}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(null)}
        />
      )}

      <AdDrawer
        data={data}
        adId={selectedAdId}
        onClose={() => setSelectedAdId(null)}
        onAsk={onAsk}
      />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h={96} radius={14} />
        ))}
      </div>
      <Skeleton h={240} radius={14} style={{ marginBottom: 28 }} />
      <div style={{ display: "grid", gap: 10 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} h={56} radius={12} />
        ))}
      </div>
    </div>
  );
}
