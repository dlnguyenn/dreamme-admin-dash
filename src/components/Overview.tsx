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
import { Icons } from "./Icons";
import { useIsMobile } from "@/lib/useIsMobile";
import type { OverviewPayload } from "@/lib/overview";
import { Card, ErrorBanner, HeroCard, StatStrip } from "./porcelain";
import { ViewsPanel } from "./overview/ViewsPanel";
import {
  OpsPanel,
  PaidPanel,
  QueuePanel,
  SupportPanel,
  TodayPanel,
  TopPostsPanel,
} from "./overview/panels";
import { fmtMoney, fmtNum, fmtPct, relTime } from "./overview/shared";

const REFRESH_MS = 120_000;

/**
 * Manual poll. The screen already refreshes on a 2-minute timer, but trial
 * starts land in rc_events within seconds of happening, so when you're watching
 * the number you want it now rather than up to two minutes from now.
 */
function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      disabled={busy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 14px",
        borderRadius: 999,
        border: `1px solid ${hover && !busy ? "var(--ink-4)" : "var(--line-2)"}`,
        background: hover && !busy ? "var(--neutral-soft)" : "transparent",
        font: "600 13px var(--font-ui)",
        color: busy ? "var(--ink-4)" : "var(--ink-2)",
        cursor: busy ? "default" : "pointer",
        transition: "background 140ms ease, border-color 140ms ease",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          animation: busy ? "spin 900ms linear infinite" : "none",
        }}
      >
        <Icons.Refresh size={14} stroke="currentColor" />
      </span>
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

export function Overview({ onNavigate }: { onNavigate: (id: DashId) => void }) {
  const isMobile = useIsMobile();
  const [data, setData] = React.useState<OverviewPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [refreshing, setRefreshing] = React.useState(false);

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
            ? `Updated ${relTime(data.generatedAt)} · auto-refreshes every 2 min`
            : loading
              ? "Loading…"
              : undefined
        }
        actions={
          <RefreshButton
            busy={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await load();
              } finally {
                setRefreshing(false);
              }
            }}
          />
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
                  // Days are Eastern, not UTC — say so, because a UTC day would
                  // roll this over at 8pm and look like a reset.
                  note: "live · ET day",
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
              <QueuePanel queue={data?.queue ?? null} />
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
