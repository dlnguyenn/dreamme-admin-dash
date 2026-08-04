"use client";

/**
 * Overview — the landing screen. One question: is the business working right
 * now? Organic reach, the north-star trial-start number, today's outgoing
 * content, support load, paid, and whether the pipeline actually ran.
 *
 * Everything comes from a single GET /api/overview, because several of the
 * tables behind it (support_threads, social_posts, slideshow_batches) are
 * service-role only and have no anon read policy.
 */

import * as React from "react";
import type { DashId } from "./Shell";
import { PageHeader } from "./Shell";
import { useIsMobile } from "@/lib/useIsMobile";
import type { OverviewPayload } from "@/lib/overview";
import { Card, ErrorBanner, HeroCard, StatStrip } from "./porcelain";
import { ViewsPanel } from "./overview/ViewsPanel";
import {
  OpsPanel,
  PaidPanel,
  SupportPanel,
  TodayPanel,
  TopPostsPanel,
} from "./overview/panels";
import { fmtMoney, fmtNum, fmtPct, relTime } from "./overview/shared";

const REFRESH_MS = 120_000;

export function Overview({ onNavigate }: { onNavigate: (id: DashId) => void }) {
  const isMobile = useIsMobile();
  const [data, setData] = React.useState<OverviewPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/overview", { cache: "no-store" });
      const body = (await res.json()) as
        | ({ ok: true } & OverviewPayload)
        | { ok: false; error: string };
      if (!body.ok) throw new Error(body.error);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    // Same pattern as App.tsx: skip polls while the tab is hidden, and catch
    // up the moment it comes back.
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const ns = data?.northStar ?? null;
  const rev = data?.revenue ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="DreamMe"
        title="Overview"
        subtitle={
          data
            ? `Updated ${relTime(data.generatedAt)}`
            : loading
              ? "Loading…"
              : undefined
        }
      />

      {error && <ErrorBanner>Couldn&apos;t load the overview — {error}</ErrorBanner>}
      {data && data.errors.length > 0 && (
        <ErrorBanner>
          Some sections failed to load: {data.errors.join(" · ")}
        </ErrorBanner>
      )}

      {loading && !data ? (
        <Card>
          <div
            style={{
              font: "400 13px var(--font-ui)",
              color: "var(--ink-3)",
              padding: "20px 0",
              textAlign: "center",
            }}
          >
            Loading overview…
          </div>
        </Card>
      ) : (
        <>
          {/* North star + the money numbers next to it. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(230px, 1fr) 2.2fr",
              gap: 14,
              marginBottom: 4,
            }}
          >
            <HeroCard
              label="Trial starts · yesterday"
              value={ns?.trialStartsYesterday != null ? fmtNum(ns.trialStartsYesterday) : "—"}
              delta={
                ns?.deltaPct != null
                  ? `${ns.deltaPct > 0 ? "+" : ""}${ns.deltaPct.toFixed(1)}%`
                  : undefined
              }
              deltaUp={(ns?.deltaPct ?? 0) >= 0}
              spark={ns?.spark}
              note={
                ns?.stale
                  ? "No RevenueCat webhook events landed for yesterday — check the pipeline"
                  : ns?.avg7d != null
                    ? `vs ${ns.avg7d} avg over the prior 7 days`
                    : undefined
              }
            />
            <StatStrip
              minColWidth={isMobile ? 130 : 150}
              stats={[
                {
                  label: "Trials today",
                  value: ns?.trialStartsToday != null ? fmtNum(ns.trialStartsToday) : "—",
                  note: "live, so far",
                },
                { label: "MRR", value: fmtMoney(rev?.mrr) },
                {
                  label: "Trials, 7d",
                  value: fmtNum(ns?.last7d),
                  note: "complete days",
                },
                { label: "Active subs", value: fmtNum(rev?.activeSubscriptions) },
              ]}
            />
          </div>

          <ViewsPanel views={data?.views ?? null} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: isMobile ? 0 : 24,
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <TodayPanel
                today={data?.today ?? null}
                onOpen={() => onNavigate("our-slideshows")}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <SupportPanel
                support={data?.support ?? null}
                onOpen={() => onNavigate("support")}
              />
              <OpsPanel ops={data?.ops ?? null} />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: isMobile ? 0 : 24,
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <TopPostsPanel posts={data?.topPosts ?? null} />
            </div>
            <div style={{ minWidth: 0 }}>
              <PaidPanel
                paid={data?.paid ?? null}
                onOpen={() => onNavigate("marketing")}
              />
            </div>
          </div>

          <div style={{ height: 40 }} />
        </>
      )}
    </div>
  );
}
