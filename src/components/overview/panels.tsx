"use client";

/**
 * The smaller Overview panels: today's outgoing content, support, top posts,
 * paid + alerts, and pipeline health.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { PERSONAS, isPersonaId } from "@/lib/personas";
import type {
  OpsCheck,
  PaidSection,
  SupportSection,
  TodaySection,
  TopPost,
} from "@/lib/overview";
import { Card, SectionHeader, StatusPill, fam } from "../porcelain";
import {
  EmptyState,
  GoToLink,
  fmtCompact,
  fmtMoney,
  fmtNum,
  fmtPct,
  relTime,
} from "./shared";

// ---------------------------------------------------------------------------
// Today's content

export function TodayPanel({
  today,
  onOpen,
}: {
  today: TodaySection | null;
  onOpen: () => void;
}) {
  const isMobile = useIsMobile();

  return (
    <>
      <SectionHeader
        family="accent"
        icon="Sun"
        title="Going out today"
        meta={
          today?.batchKey
            ? `${today.batchKey}${today.batchDate ? ` · ${today.batchDate}` : ""}`
            : undefined
        }
        right={<GoToLink label="Our Slideshows" onClick={onOpen} />}
      />
      <Card pad={isMobile ? "14px 14px" : "18px 20px"}>
        {!today || !today.batchKey ? (
          <EmptyState title="No batches published yet">
            Batches appear once <code>publish-batch-to-dash.py</code> runs.
          </EmptyState>
        ) : !today.isToday ? (
          <EmptyState title="Nothing queued for today yet">
            Latest batch is <strong>{today.batchKey}</strong> from{" "}
            {today.batchDate} ({relTime(today.batchDate)}), {today.posts.length}{" "}
            posts.
          </EmptyState>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <StatusPill
                kind={today.posts.every((p) => p.queued) ? "running" : "attention"}
              >
                {today.posts.filter((p) => p.queued).length}/{today.posts.length}{" "}
                QUEUED
              </StatusPill>
              {today.experiment && (
                // Batch theses run to several hundred words; two lines is
                // enough to recognise which experiment is running, and the
                // full text stays available on hover.
                <span
                  title={today.experiment}
                  style={{
                    font: "400 12.5px/1.45 var(--font-ui)",
                    color: "var(--ink-3)",
                    flex: 1,
                    minWidth: 140,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {today.experiment}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {today.posts.map((p) => {
                const persona = isPersonaId(p.persona) ? PERSONAS[p.persona] : null;
                return (
                  <div
                    key={p.persona}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 11px",
                      borderRadius: 10,
                      background: "var(--surface-2)",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 999,
                        background: persona?.soft ?? "var(--neutral-soft)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        flex: "none",
                      }}
                    >
                      {persona?.avatar ?? "•"}
                    </span>
                    <span
                      style={{
                        font: "650 12.5px var(--font-ui)",
                        color: "var(--ink)",
                        width: 66,
                        flex: "none",
                      }}
                    >
                      {persona?.name ?? p.persona}
                    </span>
                    <span
                      style={{
                        font: "400 12.5px var(--font-ui)",
                        color: "var(--ink-2)",
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.hook ?? undefined}
                    >
                      {p.hook ?? "—"}
                    </span>
                    {p.tier && !isMobile && (
                      <span
                        style={{
                          font: "650 10px var(--font-ui)",
                          letterSpacing: "0.04em",
                          color: "var(--ink-4)",
                          flex: "none",
                        }}
                      >
                        {p.tier}
                      </span>
                    )}
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        flex: "none",
                        background: p.queued
                          ? "var(--success)"
                          : "var(--warning)",
                      }}
                      title={p.queued ? "queued to Doublespeed" : "not queued"}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Support

export function SupportPanel({
  support,
  onOpen,
}: {
  support: SupportSection | null;
  onOpen: () => void;
}) {
  return (
    <>
      <SectionHeader
        family={support && support.unreadCount > 0 ? "attention" : "neutral"}
        icon="Inbox"
        title="Support"
        meta={
          support
            ? support.unreadCount > 0
              ? `${support.unreadCount} unread`
              : "all read"
            : undefined
        }
        right={<GoToLink label="Support Inbox" onClick={onOpen} />}
      />
      <Card pad="14px 16px">
        {!support || support.recent.length === 0 ? (
          <EmptyState title="No open threads">
            Nothing waiting in help@ or in-app feedback.
          </EmptyState>
        ) : (
          <div style={{ display: "grid", gap: 2 }}>
            {support.recent.map((t) => (
              <button
                key={t.id}
                onClick={onOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 10px",
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                  minWidth: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    flex: "none",
                    background: t.unread ? "var(--accent)" : "transparent",
                    border: t.unread ? "none" : "1px solid var(--line-2)",
                  }}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      font: `${t.unread ? 650 : 500} 13px var(--font-ui)`,
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.subject || "(no subject)"}
                  </span>
                  <span
                    style={{
                      display: "block",
                      font: "400 11.5px var(--font-ui)",
                      color: "var(--ink-4)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.from ?? "unknown sender"}
                  </span>
                </span>
                {t.urgency === "high" && (
                  <span
                    style={{
                      font: "700 9.5px var(--font-ui)",
                      letterSpacing: "0.05em",
                      background: fam("danger").soft,
                      color: fam("danger").text,
                      padding: "3px 7px",
                      borderRadius: 6,
                      flex: "none",
                    }}
                  >
                    URGENT
                  </span>
                )}
                <span
                  style={{
                    font: "400 11.5px var(--font-ui)",
                    color: "var(--ink-4)",
                    flex: "none",
                  }}
                >
                  {relTime(t.at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pipeline health

export function OpsPanel({ ops }: { ops: OpsCheck[] | null }) {
  if (!ops) return null;
  const bad = ops.filter((o) => o.state !== "ok").length;

  return (
    <>
      <SectionHeader
        family={bad > 0 ? "warning" : "success"}
        icon="Refresh"
        title="Pipeline health"
        meta={bad > 0 ? `${bad} need a look` : "all fresh"}
      />
      <Card pad="14px 16px">
        <div style={{ display: "grid", gap: 2 }}>
          {ops.map((o) => (
            <div
              key={o.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  flex: "none",
                  background:
                    o.state === "ok"
                      ? "var(--success)"
                      : o.state === "late"
                        ? "var(--warning)"
                        : "var(--ink-4)",
                }}
              />
              <span
                style={{
                  font: "500 12.5px var(--font-ui)",
                  color: "var(--ink-2)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {o.label}
              </span>
              <span
                style={{
                  font: "500 12px var(--font-ui)",
                  fontVariantNumeric: "tabular-nums",
                  color: o.state === "ok" ? "var(--ink-3)" : "var(--warning-text)",
                  flex: "none",
                }}
              >
                {o.state === "missing" ? "no data" : relTime(o.lastAt)}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 10,
            font: "400 11px/1.5 var(--font-ui)",
            color: "var(--ink-4)",
          }}
        >
          Measured from the freshest row each job writes, so this catches a job
          that produced nothing — not one that threw and left old data in place.
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Top posts

export function TopPostsPanel({ posts }: { posts: TopPost[] | null }) {
  const isMobile = useIsMobile();
  const fallback = posts?.some((p) => p.source == null) ?? false;

  return (
    <>
      <SectionHeader
        family="success"
        icon="Trend"
        title="Top posts"
        meta="last 7 days"
      />
      <Card pad={isMobile ? "14px 14px" : "16px 18px"}>
        {!posts || posts.length === 0 ? (
          <EmptyState title="No posts in the window">
            Nothing published in the last 7 days has view data yet.
          </EmptyState>
        ) : (
          <>
            <div style={{ display: "grid", gap: 2 }}>
              {posts.map((p, i) => {
                const persona = isPersonaId(p.persona ?? "")
                  ? PERSONAS[p.persona as keyof typeof PERSONAS]
                  : null;
                const row = (
                  <>
                    <span
                      style={{
                        font: "700 13px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ink-4)",
                        width: 18,
                        flex: "none",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "block",
                          font: "500 13px var(--font-ui)",
                          color: "var(--ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.title || "(no hook recorded)"}
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: "400 11.5px var(--font-ui)",
                          color: "var(--ink-4)",
                        }}
                      >
                        {[
                          persona?.name ?? p.persona,
                          p.handle ? `@${p.handle}` : p.platform,
                          relTime(p.postedAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      style={{
                        font: "700 14px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ink)",
                        flex: "none",
                      }}
                    >
                      {fmtCompact(p.views)}
                    </span>
                  </>
                );
                const style: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 8px",
                  borderRadius: 10,
                  minWidth: 0,
                  textDecoration: "none",
                };
                return p.url ? (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={style}
                  >
                    {row}
                  </a>
                ) : (
                  <div key={p.id} style={style}>
                    {row}
                  </div>
                );
              })}
            </div>
            {fallback && (
              <div
                style={{
                  marginTop: 10,
                  font: "400 11px/1.5 var(--font-ui)",
                  color: "var(--ink-4)",
                }}
              >
                TikTok only, from the nightly profile scrape — the cross-platform
                ranking lights up once the view sync is running.
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Paid + alerts

export function PaidPanel({
  paid,
  onOpen,
}: {
  paid: PaidSection | null;
  onOpen: () => void;
}) {
  const isMobile = useIsMobile();
  if (!paid) return null;

  const stats: { label: string; value: string }[] = [
    { label: "Spend", value: fmtMoney(paid.spend, 2) },
    { label: "Installs", value: fmtNum(paid.installs) },
    { label: "CPI", value: fmtMoney(paid.cpi, 2) },
    { label: "Cost / trial", value: fmtMoney(paid.costPerTrial, 2) },
  ];

  return (
    <>
      <SectionHeader
        family="warning"
        icon="Dollar"
        title="Paid"
        meta={paid.date ? `${paid.date} (last day with spend)` : undefined}
        right={<GoToLink label="Marketing Efficiency" onClick={onOpen} />}
      />
      <Card pad={isMobile ? "14px 14px" : "16px 18px"}>
        {paid.date == null ? (
          <EmptyState title="No recent Meta spend">
            Nothing in <code>ad_insights_daily</code> for the last three days.
          </EmptyState>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 96 : 120}px, 1fr))`,
              gap: 14,
            }}
          >
            {stats.map((s) => (
              <div key={s.label} style={{ minWidth: 0 }}>
                <div
                  style={{
                    font: "650 10.5px var(--font-ui)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                    marginBottom: 6,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    font: "700 20px/1 var(--font-ui)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink)",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {paid.alerts.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginTop: 16 }}>
            {paid.alerts.map((a) => {
              const family =
                a.severity === "critical"
                  ? "danger"
                  : a.severity === "warn"
                    ? "warning"
                    : "info";
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 9,
                    padding: "9px 12px",
                    borderRadius: 10,
                    background: fam(family).soft,
                    font: "400 12.5px/1.45 var(--font-ui)",
                    color: fam(family).text,
                  }}
                >
                  <span style={{ fontWeight: 700, flex: "none" }}>
                    {a.campaignName ?? "Account"}
                  </span>
                  <span style={{ minWidth: 0 }}>{a.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

export { fmtPct };
