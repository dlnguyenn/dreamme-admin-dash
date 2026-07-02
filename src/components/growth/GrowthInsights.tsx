"use client";

/**
 * Growth AI · Insights — Motion's Messaging Themes wall + comparative
 * breakdowns, computed from AI creative tags (ad_creative_tags) joined to
 * ad performance.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { type GrowthData } from "./data";
import {
  themeRollups,
  compareByDimension,
  untriedFormats,
  COMPARE_DIMENSIONS,
  type CompareDimension,
  type ThemeRollup,
  type ThemeStatus,
} from "./insights";
import {
  fmtUSD,
  fmtInt,
  fmtPct,
  SectionLabel,
  DeltaChip,
  EmptyState,
  ErrorBanner,
  Thumb,
} from "./shared";
import { VISUAL_FORMATS, VISUAL_FORMAT_LABELS } from "@/lib/growth-tagging-shared";

const STATUS_META: Record<ThemeStatus, { label: string; tone: string }> = {
  proven: { label: "Proven", tone: "var(--accent-2)" },
  scaling: { label: "Scaling", tone: "var(--p-emma)" },
  declining: { label: "Declining", tone: "var(--accent)" },
  testing: { label: "Testing", tone: "var(--ink-4)" },
};

export function GrowthInsights({
  data,
  onAsk,
  onOpenAd,
}: {
  data: GrowthData;
  onAsk: (prompt: string) => void;
  onOpenAd: (adId: string) => void;
}) {
  const isMobile = useIsMobile();
  const [tagging, setTagging] = React.useState(false);
  const [tagNote, setTagNote] = React.useState<string | null>(null);

  const themes = React.useMemo(
    () => themeRollups(data.rows, data.tags),
    [data.rows, data.tags],
  );

  const untried = React.useMemo(
    () =>
      untriedFormats(
        data.tags,
        VISUAL_FORMATS.map((id) => ({ id, label: VISUAL_FORMAT_LABELS[id] })),
      ),
    [data.tags],
  );

  const runTagger = async () => {
    setTagging(true);
    setTagNote(null);
    try {
      const res = await fetch("/api/growth/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      const body = (await res.json()) as { tagged?: number; remaining?: number; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTagNote(
        `Tagged ${body.tagged} creatives${body.remaining ? ` · ${body.remaining} remaining — run again` : ""}.`,
      );
      data.refresh();
    } catch (e) {
      setTagNote((e as Error).message);
    } finally {
      setTagging(false);
    }
  };

  if (data.error) return <ErrorBanner>{data.error}</ErrorBanner>;

  return (
    <div>
      {/* ---- messaging themes wall ---- */}
      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
            last 8 weeks · {data.tags.size} creatives tagged
          </span>
        }
      >
        Messaging themes
      </SectionLabel>

      {themes.length === 0 ? (
        <EmptyState
          title="No creative tags yet."
          action={
            <button
              onClick={() => void runTagger()}
              disabled={tagging}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                border: "1px solid var(--ink)",
                background: tagging ? "var(--surface-2)" : "var(--ink)",
                color: tagging ? "var(--ink-4)" : "var(--surface)",
                cursor: tagging ? "default" : "pointer",
              }}
            >
              {tagging ? "Tagging…" : "Tag creatives with AI"}
            </button>
          }
        >
          The AI tagger reads each ad&rsquo;s creative + copy and labels its visual format,
          messaging theme, and audience — that powers everything on this page.
          {tagNote && <div style={{ marginTop: 8, color: "var(--ink-2)" }}>{tagNote}</div>}
        </EmptyState>
      ) : (
        <>
          {tagNote && (
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink-3)" }}>{tagNote}</div>
          )}
          <div style={{ display: "grid", gap: 12, marginBottom: 32 }}>
            {themes.map((t) => (
              <ThemeCard key={t.theme} t={t} onAsk={onAsk} onOpenAd={onOpenAd} isMobile={isMobile} />
            ))}
          </div>
        </>
      )}

      {/* ---- comparative breakdowns ---- */}
      <CompareSection data={data} isMobile={isMobile} />

      {/* ---- formats not tried ---- */}
      {untried.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <SectionLabel>Visual formats you haven&rsquo;t tried yet</SectionLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {untried.map((f) => (
              <button
                key={f}
                onClick={() =>
                  onAsk(
                    `We haven't tried the "${f}" visual format yet. Based on what's working in the account, draft a creative brief for a ${f} ad worth testing.`,
                  )
                }
                title="Ask the AI for a brief in this format"
                style={{
                  padding: "7px 14px",
                  fontSize: 12.5,
                  borderRadius: 999,
                  border: "1px dashed var(--line-2)",
                  background: "var(--surface)",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                + {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeCard({
  t,
  onAsk,
  onOpenAd,
  isMobile,
}: {
  t: ThemeRollup;
  onAsk: (p: string) => void;
  onOpenAd: (adId: string) => void;
  isMobile: boolean;
}) {
  const status = STATUS_META[t.status];
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        padding: isMobile ? 14 : "16px 20px",
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      {/* thumbnail stack */}
      <div style={{ display: "flex", flexShrink: 0 }}>
        {(t.thumbs.length ? t.thumbs : [""]).slice(0, isMobile ? 2 : 4).map((src, i) => (
          <div
            key={i}
            onClick={() => t.ads[i] && onOpenAd(t.ads[i].ad_id)}
            style={{ marginLeft: i === 0 ? 0 : -18, zIndex: 4 - i, cursor: t.ads[i] ? "pointer" : "default" }}
            title={t.ads[i]?.ad_name}
          >
            <Thumb src={src} name={t.ads[i]?.ad_name ?? t.theme} size={44} radius={9} />
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <span className="serif" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>{t.theme}</span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "3px 9px",
              borderRadius: 999,
              color: `color-mix(in oklab, ${status.tone} 75%, var(--ink))`,
              background: `color-mix(in oklab, ${status.tone} 14%, var(--surface))`,
              border: `1px solid color-mix(in oklab, ${status.tone} 30%, var(--line))`,
            }}
          >
            {status.label}
          </span>
          {t.qualified > 0 && t.qualified < 3 && (
            <span style={{ fontSize: 10.5, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
              n={t.qualified}
            </span>
          )}
        </div>
        {t.description && (
          <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 10px", lineHeight: 1.5, maxWidth: 640 }}>
            {t.description}
          </p>
        )}
        <div style={{ display: "flex", gap: isMobile ? 14 : 26, flexWrap: "wrap", alignItems: "center" }}>
          <ThemeStat label="Spend" value={fmtUSD(t.spend)} extra={<DeltaChip pct={t.wowPct} goodWhen="up" />} />
          <ThemeStat label="Active" value={String(t.activeCount)} sub={`${t.ads.length} total`} />
          <ThemeStat label="Trials" value={fmtInt(t.trials)} />
          <ThemeStat label="Cost / trial" value={Number.isFinite(t.cpt) ? fmtUSD(t.cpt) : "—"} />
          <HitRateBar rate={t.hitRate} hits={t.hits} qualified={t.qualified} />
          <button
            onClick={() =>
              onAsk(
                `Analyze the "${t.theme}" messaging theme (${t.ads.length} ads, ${fmtUSD(t.spend)} spend over 8 weeks). Is the angle working, which executions carry it, and should we scale, iterate, or kill it?`,
              )
            }
            style={{
              marginLeft: "auto",
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              color: "var(--ink-2)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✦ Analyze theme
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemeStat({
  label,
  value,
  sub,
  extra,
}: {
  label: string;
  value: string;
  sub?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {extra}
        {sub && <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{sub}</span>}
      </div>
    </div>
  );
}

function HitRateBar({ rate, hits, qualified }: { rate: number | null; hits: number; qualified: number }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          marginBottom: 3,
        }}
      >
        Hit rate
      </div>
      {rate == null ? (
        <span style={{ fontSize: 13, color: "var(--ink-4)" }}>—</span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 64,
              height: 6,
              borderRadius: 999,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(rate * 100)}%`,
                height: "100%",
                background: rate >= 0.5 ? "var(--accent-2)" : rate >= 0.25 ? "var(--p-sydney)" : "var(--accent)",
              }}
            />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }} title={`${hits}/${qualified} qualified ads hit`}>
            {Math.round(rate * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparative breakdowns
// ---------------------------------------------------------------------------

const COMPARE_METRICS = [
  { id: "spend", label: "Spend" },
  { id: "cpt", label: "Cost / trial" },
  { id: "hook", label: "Hook rate" },
  { id: "ctr", label: "CTR" },
] as const;

function CompareSection({ data, isMobile }: { data: GrowthData; isMobile: boolean }) {
  const [dim, setDim] = React.useState<CompareDimension>("visual_format");
  const [days, setDays] = React.useState(14);

  const groups = React.useMemo(
    () => compareByDimension(data.rows, data.tags, dim, days),
    [data.rows, data.tags, dim, days],
  );

  const label = (key: string) =>
    dim === "visual_format"
      ? (VISUAL_FORMAT_LABELS as Record<string, string>)[key] ?? key
      : key;

  return (
    <div>
      <SectionLabel>Compare performance by dimension</SectionLabel>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {COMPARE_DIMENSIONS.map((d) => {
            const active = dim === d.id;
            return (
              <button
                key={d.id}
                onClick={() => setDim(d.id)}
                style={{
                  padding: "6px 13px",
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
                {d.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 14, 30].map((d) => {
            const active = days === d;
            return (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: "6px 11px",
                  fontSize: 12,
                  borderRadius: 999,
                  border: "1px solid",
                  borderColor: active ? "var(--ink)" : "var(--line)",
                  background: active ? "var(--ink)" : "var(--surface)",
                  color: active ? "var(--surface)" : "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                {d}d
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="Nothing to compare yet.">
          {dim === "visual_format" || dim === "messaging_theme" || dim === "audience"
            ? "This dimension needs AI tags — run the tagger above."
            : "No ads with spend in this window."}
        </EmptyState>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {COMPARE_METRICS.map((m) => (
            <ComparePanel key={m.id} metric={m.id} title={m.label} groups={groups} labelOf={label} />
          ))}
        </div>
      )}
    </div>
  );
}

function ComparePanel({
  metric,
  title,
  groups,
  labelOf,
}: {
  metric: (typeof COMPARE_METRICS)[number]["id"];
  title: string;
  groups: ReturnType<typeof compareByDimension>;
  labelOf: (key: string) => string;
}) {
  const valueOf = (g: (typeof groups)[number]): number => {
    if (metric === "spend") return g.spend;
    if (metric === "cpt") return Number.isFinite(g.cpt) ? g.cpt : NaN;
    if (metric === "hook") return Number.isFinite(g.hook) ? g.hook : NaN;
    return Number.isFinite(g.ctr) ? g.ctr : NaN;
  };
  const fmt = (v: number): string => {
    if (!Number.isFinite(v)) return "—";
    if (metric === "spend" || metric === "cpt") return fmtUSD(v);
    return fmtPct(v);
  };
  const rows = groups
    .map((g) => ({ g, v: valueOf(g) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => (metric === "cpt" ? a.v - b.v : b.v - a.v))
    .slice(0, 8);
  const max = Math.max(...rows.map((x) => x.v), 0.0001);
  // For CPT lower is better — bar length still scales to max, tone flips.
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--ink-3)",
          marginBottom: 12,
        }}
      >
        {title}
        {metric === "cpt" && (
          <span style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>· lower is better</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ink-4)" }}>no data</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map(({ g, v }, i) => (
            <div key={g.key}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 12,
                  marginBottom: 3,
                }}
              >
                <span
                  style={{
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`${labelOf(g.key)} · ${g.ads} ads`}
                >
                  {labelOf(g.key)}
                  <span style={{ color: "var(--ink-4)", marginLeft: 6, fontSize: 10.5 }}>{g.ads}</span>
                </span>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {fmt(v)}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "var(--surface-2)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(3, (v / max) * 100)}%`,
                    height: "100%",
                    borderRadius: 999,
                    background:
                      metric === "cpt"
                        ? i === 0
                          ? "var(--accent-2)"
                          : "color-mix(in oklab, var(--ink) 45%, transparent)"
                        : i === 0
                          ? "var(--ink)"
                          : "color-mix(in oklab, var(--ink) 45%, transparent)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
