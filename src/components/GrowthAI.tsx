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
import { Button } from "./ui";
import { Icons } from "./Icons";
import { FilterPill } from "./porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import { useGrowthData } from "./growth/data";
import { GrowthOverview } from "./growth/GrowthOverview";
import { GrowthLeaderboard } from "./growth/GrowthLeaderboard";
import { GrowthLaunches } from "./growth/GrowthLaunches";
import { GrowthInsights } from "./growth/GrowthInsights";
import { GrowthInspo } from "./growth/GrowthInspo";
import { GrowthCompetitors } from "./growth/GrowthCompetitors";
import { GrowthAnalyst } from "./growth/GrowthAnalyst";
import { AdDrawer } from "./growth/AdDrawer";
import { Skeleton } from "./growth/shared";

type Subtab = "overview" | "creatives" | "insights" | "inspo" | "competitors" | "analyst";
type CreativesView = "leaderboard" | "launches";

const SUBTAB_KEY = "dreamme.growth.subtab";
const CREATIVES_VIEW_KEY = "dreamme.growth.creativesView";

const SUBTABS: Array<{ id: Subtab; label: string; short: string }> = [
  { id: "overview", label: "Overview", short: "Overview" },
  { id: "creatives", label: "Creatives", short: "Creatives" },
  { id: "insights", label: "Insights", short: "Insights" },
  { id: "inspo", label: "Inspo", short: "Inspo" },
  { id: "competitors", label: "Competitors", short: "Rivals" },
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
        saved === "competitors" ||
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
        eyebrow="Admin / Paid social"
        title="Growth AI"
        subtitle="Your all-in-one paid-social command center: easy-to-read creative analytics plus an AI brain that reads the live numbers — built for consumer apps, not DTC."
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={data.refresh}>
            Refresh
          </Button>
        }
      />

      {/* Segmented view tabs (Porcelain: bg-2 track, white selected cell) —
          sticky so the nav survives long leaderboards/theme walls */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "inline-flex",
          gap: 2,
          padding: 3,
          background: "var(--bg-2)",
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
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: isMobile ? "7px 12px" : "7px 15px",
                font: `${active ? 650 : 500} 13px var(--font-ui)`,
                borderRadius: 9,
                border: "none",
                background: active ? "var(--surface)" : "transparent",
                boxShadow: active ? "var(--shadow-xs)" : "none",
                color: active ? "var(--ink)" : "var(--ink-2)",
                cursor: "pointer",
                transition: "background 140ms ease, color 140ms ease",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = "var(--ink)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = "var(--ink-2)";
              }}
            >
              {t.id === "analyst" && (
                <Icons.Spark size={13} stroke="var(--accent)" strokeWidth={1.8} />
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
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {(
              [
                { id: "leaderboard", label: "Leaderboard" },
                { id: "launches", label: "New launches" },
              ] as Array<{ id: CreativesView; label: string }>
            ).map((v) => (
              <FilterPill
                key={v.id}
                label={v.label}
                selected={creativesView === v.id}
                onClick={() => {
                  setCreativesView(v.id);
                  try {
                    localStorage.setItem(CREATIVES_VIEW_KEY, v.id);
                  } catch {}
                }}
              />
            ))}
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
      ) : subtab === "competitors" ? (
        <GrowthCompetitors onAsk={onAsk} />
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
