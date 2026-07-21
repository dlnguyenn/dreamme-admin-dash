"use client";

/**
 * Pricing Experiments — live tracking for subscription price changes.
 *
 * Sits on the Marketing Efficiency page under the paid-ads experiment cards.
 * Pulls weekly trial starts + CVR by plan duration (P1M/P3M/P1Y) straight
 * from RevenueCat via /api/pricing-experiment and computes a before/after
 * read around each price change's start date.
 *
 * Experiment defs are hand-maintained like EXPERIMENTS in
 * MarketingEfficiency.tsx — when a price change ships, set `startedISO` and
 * the card starts reading automatically. Full protocol per experiment lives
 * in the ops repo at the `file` path.
 */
import * as React from "react";
import {
  isMature,
  type DurationStats,
  type PricingExperimentResponse,
  type PricingWeek,
} from "@/lib/pricing-experiment";

interface PricingExperimentDef {
  id: string;
  title: string;
  change: string;
  /** null = planned, not live yet — card renders as PENDING, no read. */
  startedISO: string | null;
  /** When the read is due (~3 wks after start so trial weeks mature). */
  readISO: string | null;
  rule: string;
  file: string;
}

const PRICING_EXPERIMENTS: PricingExperimentDef[] = [
  {
    id: "monthly-15",
    title: "Monthly price raise",
    change: "$9.99 → $14.99/mo (+50%), new subs only",
    startedISO: "2026-06-29",
    readISO: "2026-07-27",
    rule:
      "Win if total trial CVR holds ≥ 36% and blended new-payer revenue/wk rises · " +
      "Revert if total CVR < 33% for 2 consecutive mature weeks",
    file: "experiments/2026-07-20-pricing-ladder-raise.md",
  },
  {
    id: "ladder-45-30",
    title: "Yearly special + quarterly raise",
    change: "Yearly special $39.99 → $44.99 (+12.5%) · Quarterly $24.99 → $29.99 (+20%), new subs only",
    startedISO: null, // ← set to the go-live date when App Store prices flip
    readISO: null, // ← set to startedISO + ~3 weeks
    rule:
      "Win if P1Y trial CVR drop < 2pts vs 4wk baseline · " +
      "Revert if P1Y CVR down > 4pts for 2 consecutive mature weeks · " +
      "Guardrail: total trial starts/wk within −15% of baseline",
    file: "experiments/2026-07-20-pricing-ladder-raise.md",
  },
];

const DURATION_LABEL: Record<string, string> = {
  P1M: "Monthly",
  P3M: "Quarterly",
  P1Y: "Yearly",
};

// ---------------------------------------------------------------------------
// Read computation — averages over mature weeks before/after a start date.
// ---------------------------------------------------------------------------

interface WindowRead {
  weeks: number;
  totalStarts: number; // avg per week
  totalCvr: number | null; // weighted by starts, mature weeks only
  p1mStarts: number;
  p1mCvr: number | null;
  p1yStarts: number;
  p1yCvr: number | null;
  yearlyShare: number | null; // P1Y starts / total starts
}

function addDaysISO(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function weightedCvr(pairs: Array<{ starts: number; cvr: number | null }>): number | null {
  let starts = 0;
  let converted = 0;
  for (const p of pairs) {
    if (p.cvr == null || p.starts === 0) continue;
    starts += p.starts;
    converted += (p.cvr / 100) * p.starts;
  }
  return starts > 0 ? (converted / starts) * 100 : null;
}

/**
 * Average a set of weeks into one read. Starts come from all fully-elapsed
 * weeks; CVRs only from mature ones (7-day trials resolved).
 */
function summarizeWeeks(weeks: PricingWeek[], todayISO: string): WindowRead | null {
  const elapsed = weeks.filter((w) => addDaysISO(w.weekStart, 7) <= todayISO);
  if (elapsed.length === 0) return null;
  const mature = elapsed.filter((w) => isMature(w.total));
  const avg = (f: (w: PricingWeek) => number) =>
    elapsed.reduce((s, w) => s + f(w), 0) / elapsed.length;

  const totalStarts = avg((w) => w.total.starts);
  const p1yStarts = avg((w) => w.byDuration.P1Y?.starts ?? 0);
  return {
    weeks: elapsed.length,
    totalStarts,
    totalCvr: weightedCvr(mature.map((w) => ({ starts: w.total.starts, cvr: w.total.cvr }))),
    p1mStarts: avg((w) => w.byDuration.P1M?.starts ?? 0),
    p1mCvr: weightedCvr(
      mature.map((w) => ({
        starts: w.byDuration.P1M?.starts ?? 0,
        cvr: w.byDuration.P1M?.cvr ?? null,
      })),
    ),
    p1yStarts,
    p1yCvr: weightedCvr(
      mature.map((w) => ({
        starts: w.byDuration.P1Y?.starts ?? 0,
        cvr: w.byDuration.P1Y?.cvr ?? null,
      })),
    ),
    yearlyShare: totalStarts > 0 ? (p1yStarts / totalStarts) * 100 : null,
  };
}

function experimentRead(
  weeks: PricingWeek[],
  startedISO: string,
  todayISO: string,
): { pre: WindowRead | null; post: WindowRead | null } {
  const preWeeks = weeks
    .filter((w) => addDaysISO(w.weekStart, 7) <= startedISO && isMature(w.total))
    .slice(-4);
  const postWeeks = weeks.filter((w) => w.weekStart >= startedISO);
  return {
    pre: summarizeWeeks(preWeeks, todayISO),
    post: summarizeWeeks(postWeeks, todayISO),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function fmtNum(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function Delta({
  pre,
  post,
  unit,
  goodWhenUp,
}: {
  pre: number | null;
  post: number | null;
  unit: "%" | "#";
  goodWhenUp: boolean;
}) {
  if (pre == null || post == null) {
    return <span style={{ color: "var(--ink-3)" }}>—</span>;
  }
  const diff = post - pre;
  const up = diff >= 0;
  const magnitude = unit === "%" ? Math.abs(diff) : Math.abs(diff) / Math.max(1, pre) * 100;
  const neutral = magnitude < 1.5; // small moves render calm, not colored
  const good = up === goodWhenUp;
  const color = neutral
    ? "var(--ink-2)"
    : good
      ? "color-mix(in oklab, var(--p-olivia) 70%, var(--ink))"
      : "var(--accent)";
  const fmt = (v: number) => (unit === "%" ? fmtPct(v) : fmtNum(v));
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {fmt(pre)}{" "}
      <span style={{ color, fontWeight: 600 }}>
        → {fmt(post)}
      </span>
    </span>
  );
}

function ReadRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span style={{ color: "var(--ink)" }}>{children}</span>
    </div>
  );
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(`${iso}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
}

function ExperimentCard({
  def,
  weeks,
  todayISO,
}: {
  def: PricingExperimentDef;
  weeks: PricingWeek[] | null;
  todayISO: string;
}) {
  const live = def.startedISO != null;
  const read =
    live && weeks ? experimentRead(weeks, def.startedISO as string, todayISO) : null;
  const readLeft = def.readISO ? daysUntil(def.readISO) : null;
  const ready = readLeft != null && readLeft <= 0;

  const edge = !live
    ? "var(--ink-3)"
    : ready
      ? "var(--accent)"
      : "color-mix(in oklab, var(--p-emma) 65%, var(--ink))";

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: `3px solid ${edge}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div className="serif" style={{ fontSize: 19, letterSpacing: "-0.02em" }}>
          {def.title}{" "}
          <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>· {def.change}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "3px 8px",
              borderRadius: 999,
              color: !live
                ? "var(--ink-3)"
                : ready
                  ? "var(--accent)"
                  : "color-mix(in oklab, var(--p-olivia) 70%, var(--ink))",
              background: !live
                ? "var(--surface-2)"
                : ready
                  ? "color-mix(in oklab, var(--accent) 12%, var(--surface))"
                  : "color-mix(in oklab, var(--p-olivia) 14%, var(--surface))",
              border: "1px solid var(--line)",
            }}
          >
            {!live ? "Pending" : ready ? "Ready to read" : "Running"}
          </span>
          {live && def.readISO && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: "var(--ink-3)",
              }}
            >
              {ready
                ? `read due ${fmtDate(def.readISO)}`
                : `reads ${fmtDate(def.readISO)} · ${readLeft}d`}
            </span>
          )}
          {live && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: "var(--ink-3)",
              }}
            >
              live {fmtDate(def.startedISO as string)}
            </span>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>{def.rule}</div>

      {!live ? (
        <div
          style={{
            padding: "10px 12px",
            fontSize: 12.5,
            color: "var(--ink-3)",
            background: "var(--surface-2)",
            border: "1px dashed var(--line)",
            borderRadius: 10,
          }}
        >
          Not live yet — when the App Store prices flip, set <code>startedISO</code> (and{" "}
          <code>readISO</code> ≈ +3 weeks) for this card in{" "}
          <code>PricingExperiments.tsx</code>. The before/after read starts automatically.
        </div>
      ) : read?.pre && read?.post ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: "6px 28px",
            padding: "10px 12px",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 10,
          }}
        >
          <ReadRow label="Total trial CVR">
            <Delta pre={read.pre.totalCvr} post={read.post.totalCvr} unit="%" goodWhenUp={true} />
          </ReadRow>
          <ReadRow label="Trial starts /wk">
            <Delta
              pre={read.pre.totalStarts}
              post={read.post.totalStarts}
              unit="#"
              goodWhenUp={true}
            />
          </ReadRow>
          <ReadRow label="Yearly share of starts">
            <Delta
              pre={read.pre.yearlyShare}
              post={read.post.yearlyShare}
              unit="%"
              goodWhenUp={true}
            />
          </ReadRow>
          <ReadRow label="Yearly CVR">
            <Delta pre={read.pre.p1yCvr} post={read.post.p1yCvr} unit="%" goodWhenUp={true} />
          </ReadRow>
          <ReadRow label="Monthly CVR">
            <Delta pre={read.pre.p1mCvr} post={read.post.p1mCvr} unit="%" goodWhenUp={true} />
          </ReadRow>
          <ReadRow label="Monthly starts /wk">
            <Delta
              pre={read.pre.p1mStarts}
              post={read.post.p1mStarts}
              unit="#"
              goodWhenUp={true}
            />
          </ReadRow>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {weeks ? "Post-change weeks still maturing — read appears once trials resolve." : "Loading RevenueCat data…"}
        </div>
      )}

      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          color: "var(--ink-3)",
        }}
      >
        pre = last 4 mature weeks before change · post = weeks since, CVR from mature weeks only ·{" "}
        {def.file}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly table with change markers
// ---------------------------------------------------------------------------

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "11px 14px",
        fontSize: 10,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "var(--ink-3)",
        borderBottom: "1px solid var(--line)",
        background: "var(--surface-2)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "right",
  muted = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
        color: muted ? "var(--ink-3)" : "var(--ink)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function CvrCell({ stats }: { stats: DurationStats | undefined }) {
  if (!stats || stats.starts === 0) return <Td muted>—</Td>;
  const mature = isMature(stats);
  return (
    <Td muted={!mature}>
      {stats.cvr != null ? `${stats.cvr.toFixed(1)}%` : "—"}
      {!mature && <span title="Still maturing — trials in the 7-day window unresolved">*</span>}
    </Td>
  );
}

export function PricingExperiments() {
  const [data, setData] = React.useState<PricingExperimentResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const todayISO = new Date().toISOString().slice(0, 10);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/pricing-experiment")
      .then(async (r) => {
        const body = (await r.json()) as PricingExperimentResponse & { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        if (alive) setData(body);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const weeks = data?.weeks ?? null;

  // Change markers: experiments whose startedISO falls inside a rendered week.
  const markerByWeek = new Map<string, PricingExperimentDef[]>();
  if (weeks) {
    for (const def of PRICING_EXPERIMENTS) {
      if (!def.startedISO) continue;
      for (const w of weeks) {
        if (def.startedISO >= w.weekStart && def.startedISO < addDaysISO(w.weekStart, 7)) {
          const list = markerByWeek.get(w.weekStart) ?? [];
          list.push(def);
          markerByWeek.set(w.weekStart, list);
        }
      }
    }
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--ink-3)",
          marginBottom: 12,
        }}
      >
        Pricing experiments
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          RevenueCat fetch failed: {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        {PRICING_EXPERIMENTS.map((def) => (
          <ExperimentCard key={def.id} def={def} weeks={weeks} todayISO={todayISO} />
        ))}
      </div>

      {weeks && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            overflowX: "auto",
            background: "var(--surface)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th align="left">Week of</Th>
                <Th>Monthly starts</Th>
                <Th>Monthly CVR</Th>
                <Th>Quarterly starts</Th>
                <Th>Quarterly CVR</Th>
                <Th>Yearly starts</Th>
                <Th>Yearly CVR</Th>
                <Th>Total CVR</Th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const markers = markerByWeek.get(w.weekStart) ?? [];
                const m = w.byDuration.P1M;
                const q = w.byDuration.P3M;
                const y = w.byDuration.P1Y;
                return (
                  <React.Fragment key={w.weekStart}>
                    {markers.map((def) => (
                      <tr key={`marker-${def.id}`}>
                        <td
                          colSpan={8}
                          style={{
                            padding: "7px 14px",
                            fontSize: 11,
                            fontFamily: "var(--font-geist-mono), monospace",
                            letterSpacing: "0.06em",
                            color: "var(--accent)",
                            background: "color-mix(in oklab, var(--accent) 8%, var(--surface))",
                            borderBottom: "1px solid var(--line)",
                          }}
                        >
                          ⚡ {def.title} live — {def.change}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <Td align="left">{fmtDate(w.weekStart)}</Td>
                      <Td>{m ? fmtNum(m.starts) : "—"}</Td>
                      <CvrCell stats={m} />
                      <Td>{q ? fmtNum(q.starts) : "—"}</Td>
                      <CvrCell stats={q} />
                      <Td>{y ? fmtNum(y.starts) : "—"}</Td>
                      <CvrCell stats={y} />
                      <CvrCell stats={w.total} />
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-3)" }}>
        * CVR still maturing — that week&rsquo;s 7-day trials haven&rsquo;t all resolved yet.
        Source: RevenueCat trial conversion by product duration, weekly.
      </div>
    </div>
  );
}
