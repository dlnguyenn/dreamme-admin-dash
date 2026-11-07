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
import { DOUBLESPEED_PAUSED } from "@/lib/doublespeedPause";
import { Card, ErrorBanner, HeroCard, StatStrip } from "./porcelain";
import { ViewsPanel } from "./overview/ViewsPanel";
import { AttributionPanel } from "./overview/AttributionPanel";
import { MorningPanel } from "./overview/MorningPanel";
import { PaidPanel } from "./overview/PaidPanel";
import { NeedsAttention } from "./overview/NeedsAttention";
import {
  OpsPanel,
  QueuePanel,
  SupportPanel,
  TodayPanel,
  TopPostsPanel,
} from "./overview/panels";
import { fmtMoney, fmtNum, fmtPct, relTime } from "./overview/shared";

const REFRESH_MS = 120_000;

/**
 * Sections the Overview can hide. Stored per browser; organic views and top
 * posts start hidden because Doublespeed is paused and they read stale.
 */
type SectionId =
  | "attribution"
  | "paid"
  | "views"
  | "morning"
  | "today"
  | "queue"
  | "support"
  | "ops"
  | "topPosts";

const SECTION_LABELS: Record<SectionId, string> = {
  attribution: "Where they heard about us",
  paid: "Paid",
  views: "Organic views",
  morning: "This morning’s posts",
  today: "Going out today",
  queue: "Account queue",
  support: "Support",
  ops: "Pipeline health",
  topPosts: "Top posts",
};

const DOUBLESPEED_ONLY = new Set<SectionId>(["morning", "today", "queue"]);
const SECTION_ORDER = (Object.keys(SECTION_LABELS) as SectionId[]).filter(
  (id) => !(DOUBLESPEED_PAUSED && DOUBLESPEED_ONLY.has(id)),
);
const DEFAULT_HIDDEN: SectionId[] = ["views", "topPosts"];
const HIDDEN_KEY = "dad.overview.hidden.v1";

function useHiddenSections() {
  const [hidden, setHidden] = React.useState<Set<SectionId>>(() => new Set(DEFAULT_HIDDEN));
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      if (raw) {
        const ids = (JSON.parse(raw) as string[]).filter(
          (x): x is SectionId => x in SECTION_LABELS,
        );
        setHidden(new Set(ids));
      }
    } catch {
      // private window or blocked storage: keep the defaults
    }
  }, []);
  const toggle = React.useCallback((id: SectionId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        // not persisted, still applies for this visit
      }
      return next;
    });
  }, []);
  return { hidden, toggle };
}

function SectionsMenu({
  hidden,
  onToggle,
}: {
  hidden: Set<SectionId>;
  onToggle: (id: SectionId) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const hiddenCount = SECTION_ORDER.filter((id) => hidden.has(id)).length;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "8px 14px",
          borderRadius: 999,
          border: "1px solid var(--line-2)",
          background: open ? "var(--neutral-soft)" : "transparent",
          font: "600 13px var(--font-ui)",
          color: "var(--ink-2)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <Icons.Layers size={14} stroke="currentColor" />
        Sections{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 30,
            minWidth: 240,
            background: "var(--surface)",
            border: "1px solid var(--line-2)",
            borderRadius: 12,
            boxShadow: "var(--shadow-card)",
            padding: 6,
          }}
        >
          <div
            style={{
              font: "650 10.5px var(--font-ui)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              padding: "6px 10px 4px",
            }}
          >
            Show on Overview
          </div>
          {SECTION_ORDER.map((id) => (
            <label
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                font: "500 13px var(--font-ui)",
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={!hidden.has(id)}
                onChange={() => onToggle(id)}
                style={{ accentColor: "var(--accent)", width: 15, height: 15, margin: 0 }}
              />
              {SECTION_LABELS[id]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Two columns on desktop, collapsing to one when a side has nothing shown. */
function TwoCol({
  left,
  right,
  isMobile,
}: {
  left: React.ReactNode[];
  right: React.ReactNode[];
  isMobile: boolean;
}) {
  const l = left.filter(Boolean);
  const r = right.filter(Boolean);
  if (l.length === 0 && r.length === 0) return null;
  const single = isMobile || l.length === 0 || r.length === 0;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: single ? "1fr" : "1fr 1fr",
        gap: single ? 0 : 24,
        alignItems: "start",
      }}
    >
      {l.length > 0 && <div style={{ minWidth: 0 }}>{l}</div>}
      {r.length > 0 && <div style={{ minWidth: 0 }}>{r}</div>}
    </div>
  );
}

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
  const { hidden, toggle } = useHiddenSections();
  const show = (id: SectionId) => !hidden.has(id);

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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <SectionsMenu hidden={hidden} onToggle={toggle} />
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
          </div>
        }
      />

      {error && <ErrorBanner>Couldn&apos;t load the overview — {error}</ErrorBanner>}
      {/* Section failures are listed in Needs attention; this is the fallback when that failed too. */}
      {data && data.urgent == null && data.errors.length > 0 && (
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
          <NeedsAttention alerts={data?.urgent ?? null} onNavigate={onNavigate} />

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
                  // The day basis lives in the label, not the note: days are
                  // Eastern rather than UTC (a UTC day would roll over at 8pm
                  // and look like a reset), and the note now has to carry the
                  // onboarding ratio instead. Mixpanel's project timezone is
                  // Eastern too, which is what makes that ratio valid.
                  label: "Trials today · ET",
                  value: ns?.trialStartsToday != null ? fmtNum(ns.trialStartsToday) : "—",
                  // StatStrip notes are nowrap + ellipsis in a ~124px cell
                  // (measured, and it is 124px on desktop too — the strip is
                  // four columns inside a narrow panel). "onboarding starts"
                  // needs 202px and "starts · ET" breaks the first time
                  // onboarding hits four digits, so this is the longest form
                  // that survives a spike day: 115px at 100.0% of 1,013.
                  note:
                    ns?.trialStartRatePct != null && ns.onboardingStartsToday != null
                      ? `${ns.trialStartRatePct}% of ${fmtNum(ns.onboardingStartsToday)} starts`
                      : "live",
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

          {show("attribution") && (
            <AttributionPanel attribution={data?.attribution ?? null} />
          )}

          {show("paid") && (
            <PaidPanel paid={data?.paid ?? null} onOpen={() => onNavigate("marketing")} />
          )}

          {show("views") && <ViewsPanel views={data?.views ?? null} />}

          {/* Did the machines run — sits under the reach numbers it feeds. */}
          {!DOUBLESPEED_PAUSED && show("morning") && (
            <MorningPanel morning={data?.morning ?? null} onQueued={load} />
          )}

          <TwoCol
            isMobile={isMobile}
            left={
              DOUBLESPEED_PAUSED
                ? [
                    show("support") && (
                      <SupportPanel
                        key="support"
                        support={data?.support ?? null}
                        onOpen={() => onNavigate("support")}
                      />
                    ),
                  ]
                : [
                    show("today") && (
                      <TodayPanel
                        key="today"
                        today={data?.today ?? null}
                        onOpen={() => onNavigate("our-slideshows")}
                      />
                    ),
                    show("queue") && <QueuePanel key="queue" queue={data?.queue ?? null} />,
                  ]
            }
            right={[
              !DOUBLESPEED_PAUSED && show("support") && (
                <SupportPanel
                  key="support"
                  support={data?.support ?? null}
                  onOpen={() => onNavigate("support")}
                />
              ),
              show("ops") && <OpsPanel key="ops" ops={data?.ops ?? null} />,
            ]}
          />

          {show("topPosts") && <TopPostsPanel posts={data?.topPosts ?? null} />}

          {SECTION_ORDER.some((id) => hidden.has(id)) && (
            <div style={{ marginTop: 28, font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>
              Hidden:{" "}
              {SECTION_ORDER.filter((id) => hidden.has(id))
                .map((id) => SECTION_LABELS[id])
                .join(", ")}
              . Turn them back on from Sections at the top.
            </div>
          )}

          <div style={{ height: 40 }} />
        </>
      )}
    </div>
  );
}
