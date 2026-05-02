"use client";

import * as React from "react";
import { HOOK_CATEGORY_LABELS } from "@/lib/hook-categories";
import type { SpyTrends } from "./SpyTypes";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function SpyTrendsView() {
  const [trends, setTrends] = React.useState<SpyTrends | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/spy/trends", { cache: "no-store" });
        const json = (await res.json()) as SpyTrends | { ok: false; error: string };
        if (!res.ok || !("ok" in json) || json.ok !== true) {
          throw new Error(("error" in json && json.error) || `HTTP ${res.status}`);
        }
        if (!cancelled) setTrends(json);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          border: "1px solid var(--accent)",
          borderRadius: 10,
          background: "color-mix(in oklab, var(--accent) 10%, transparent)",
          color: "var(--accent)",
          fontSize: 13,
        }}
      >
        Could not load trends — {error}
      </div>
    );
  }
  if (!trends) {
    return (
      <div
        style={{
          padding: 24,
          border: "1px dashed var(--line-2)",
          borderRadius: 10,
          color: "var(--ink-4)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        Loading trends…
      </div>
    );
  }

  const maxCategoryViews = Math.max(1, ...trends.categories.map((c) => c.views));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Window summary */}
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Last {trends.windowDays} days · {trends.samples} videos surfaced
      </div>

      {/* Top hooks */}
      <Section title="Top hooks (by views)">
        {trends.topHooks.length === 0 ? (
          <Empty>No hooks yet — wait for the next 03:00 UTC scrape.</Empty>
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {trends.topHooks.map((h, i) => (
              <div
                key={h.postId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) 90px",
                  gap: 14,
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom:
                    i < trends.topHooks.length - 1
                      ? "1px solid var(--line)"
                      : "none",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--ink-4)",
                    textAlign: "right",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div
                  className="serif"
                  style={{
                    fontSize: 14,
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={h.hook}
                >
                  {h.hook}
                </div>
                <div
                  className="serif"
                  style={{
                    fontSize: 16,
                    color: "var(--ink-2)",
                    textAlign: "right",
                    fontWeight: 400,
                  }}
                >
                  {fmt(h.views)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Category distribution */}
      <Section title="Category distribution (by views)">
        {trends.categories.length === 0 ? (
          <Empty>No category data yet.</Empty>
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {trends.categories.map((c) => {
              const pct = (c.views / maxCategoryViews) * 100;
              return (
                <div
                  key={c.category}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px minmax(0, 1fr) 80px 50px",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--ink-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {HOOK_CATEGORY_LABELS[c.category as keyof typeof HOOK_CATEGORY_LABELS] ?? c.category}
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: "var(--surface-2)",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: `${pct}%`,
                        background: "var(--p-emma)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <div
                    className="serif"
                    style={{ fontSize: 14, color: "var(--ink)", textAlign: "right" }}
                  >
                    {fmt(c.views)}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--ink-4)",
                      textAlign: "right",
                    }}
                  >
                    {c.posts} posts
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Top hashtags */}
      <Section title="Top hashtags (by surfaced views)">
        {trends.hashtags.length === 0 ? (
          <Empty>No hashtag data yet.</Empty>
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {trends.hashtags.map((h, i) => (
              <div
                key={h.hashtag}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 80px 80px 80px",
                  gap: 12,
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom:
                    i < trends.hashtags.length - 1
                      ? "1px solid var(--line)"
                      : "none",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  #{h.hashtag}
                </span>
                <div
                  className="serif"
                  style={{ fontSize: 16, color: "var(--ink)", textAlign: "right" }}
                  title="Total views surfaced from this hashtag in the window"
                >
                  {fmt(h.views)}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-4)", textAlign: "right" }}
                >
                  {h.posts} posts
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color:
                      h.viralCount > 0 ? "var(--accent)" : "var(--ink-4)",
                    textAlign: "right",
                  }}
                >
                  {h.viralCount} viral
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        border: "1px dashed var(--line-2)",
        borderRadius: 10,
        color: "var(--ink-4)",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
