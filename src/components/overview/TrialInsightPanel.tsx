"use client";

/**
 * The Overview trial tiles, opened: "Why it moved" under the yesterday tile
 * and "Pace" under the trials-today tile. Data: /api/overview/trial-insights
 * (rules in src/lib/trial-insights.ts). Inline under the top row, not a modal.
 */

import * as React from "react";
import type { Reason, TrialInsights, TrialPace, TrialWhy } from "@/lib/trial-insights";
import { Card } from "../porcelain";
import { fmtNum } from "./shared";

export type TrialPanel = "why" | "pace";
export const TRIAL_PANEL_ID = "trial-insight-panel";

const signed = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(Math.round(n))}`;

function longDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function clock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

export function TrialInsightPanel({
  panel,
  insights,
  error,
  onboardingToday,
}: {
  panel: TrialPanel;
  insights: TrialInsights | null;
  error: string | null;
  /** Mixpanel onboarding starts today, for the pace panel's trial-rate line. */
  onboardingToday: number | null;
}) {
  return (
    <div id={TRIAL_PANEL_ID} role="region" aria-label={panel === "why" ? "Why trial starts moved" : "Trial pace today"}>
      <Card pad="20px 22px 18px" style={{ marginTop: 14 }}>
        {!insights ? (
          <div style={{ font: "400 13px var(--font-ui)", color: error ? "var(--danger-text)" : "var(--ink-3)" }}>
            {error ? `Couldn't load this: ${error}` : "Reading the numbers…"}
          </div>
        ) : panel === "why" ? (
          <WhyView why={insights.why} />
        ) : (
          <PaceView pace={insights.pace} onboardingToday={onboardingToday} />
        )}
      </Card>
    </div>
  );
}

// ---- Why ------------------------------------------------------------------

function WhyView({ why }: { why: TrialWhy | null }) {
  if (!why) {
    return <Muted>Not enough trial history to compare yesterday against.</Muted>;
  }
  const causes = why.reasons.filter((r) => r.impact != null && r.kind !== "platform" && r.kind !== "change");
  const landed = why.reasons.filter((r) => r.kind === "platform");
  const changes = why.reasons.filter((r) => r.kind === "change");
  const title =
    why.direction === "flat"
      ? "Yesterday was in line with the week before"
      : why.headline ?? `Trial starts are ${why.direction}, with no clear single cause`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h3 style={{ font: "650 17px/1.35 var(--font-ui)", color: "var(--ink)", margin: 0, maxWidth: "62ch" }}>{title}</h3>
        <p style={{ font: "400 13px/1.55 var(--font-ui)", color: "var(--ink-2)", margin: "6px 0 0", maxWidth: "72ch" }}>
          {fmtNum(why.value)} trials on {longDay(why.date)} against {why.baseline.toFixed(1)} a day the week before (
          {signed(why.changePct)}%)
          {why.dayBefore != null ? `, and ${fmtNum(why.dayBefore)} the day before` : ""}.
        </p>
      </div>

      {causes.length > 0 && (
        <Group title="Likely causes, biggest first" note="Effect on yesterday's count, in trials">
          {causes.map((r) => (
            <ReasonRow key={r.id} reason={r} against={Math.sign(r.impact!) !== Math.sign(why.change)} />
          ))}
        </Group>
      )}
      {landed.length > 0 && (
        <Group title="Where it landed">
          {landed.map((r) => (
            <ReasonRow key={r.id} reason={r} />
          ))}
        </Group>
      )}
      {changes.length > 0 && (
        <Group title="Changes logged around then">
          {changes.map((r) => (
            <ReasonRow key={r.id} reason={r} />
          ))}
        </Group>
      )}

      <Muted>
        A guess from these numbers, not proof. The onboarding and trial-rate lines add up to the whole change; the
        others are evidence beside them. Meta&apos;s own trial counts run high.
      </Muted>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h4 style={{ font: "600 13px var(--font-ui)", color: "var(--ink)", margin: 0 }}>{title}</h4>
        {note && <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{note}</span>}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </ul>
    </section>
  );
}

function ReasonRow({ reason, against }: { reason: Reason; against?: boolean }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 10, alignItems: "baseline" }}>
      <span
        style={{
          font: "650 13px var(--font-ui)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          color: reason.impact == null ? "var(--ink-4)" : against ? "var(--ink-3)" : "var(--ink)",
        }}
      >
        {reason.impact == null ? "" : signed(reason.impact)}
      </span>
      <span style={{ font: "400 13.5px/1.5 var(--font-ui)", color: against ? "var(--ink-3)" : "var(--ink-2)" }}>
        {reason.text}
        {against && " (pushed the other way)"}
      </span>
    </li>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ font: "400 12px/1.5 var(--font-ui)", color: "var(--ink-3)", margin: 0, maxWidth: "80ch" }}>{children}</p>
  );
}

// ---- Pace -----------------------------------------------------------------

function PaceView({ pace, onboardingToday }: { pace: TrialPace | null; onboardingToday: number | null }) {
  if (!pace) return <Muted>Not enough trial history yet to judge today&apos;s pace.</Muted>;
  const title = pace.early
    ? `Too early to call; a usual day ends near ${fmtNum(pace.typicalDay)}`
    : `On pace for about ${fmtNum(pace.projected)} trials today`;
  const vs =
    pace.vsTypicalPct == null
      ? ""
      : Math.abs(pace.vsTypicalPct) < 3
        ? ", right on a usual day's pace"
        : `, ${Math.abs(pace.vsTypicalPct)}% ${pace.vsTypicalPct > 0 ? "ahead of" : "behind"} a usual day`;
  const rate =
    onboardingToday != null && onboardingToday > 0
      ? ` ${((pace.soFar / onboardingToday) * 100).toFixed(1)}% of today's ${fmtNum(onboardingToday)} onboarding starts.`
      : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ font: "650 17px/1.35 var(--font-ui)", color: "var(--ink)", margin: 0 }}>{title}</h3>
        <p style={{ font: "400 13px/1.55 var(--font-ui)", color: "var(--ink-2)", margin: "6px 0 0", maxWidth: "76ch" }}>
          {fmtNum(pace.soFar)} so far by {clock(pace.minuteOfDay)} Eastern against {pace.typicalByNow.toFixed(1)} by now on a
          usual day{vs}. Likely range {fmtNum(pace.low)} to {fmtNum(pace.high)}; a usual day ends at {fmtNum(pace.typicalDay)}.
          {rate}
        </p>
      </div>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <Figure
          label="Last hour"
          value={`${fmtNum(pace.lastHour)} ${pace.lastHour === 1 ? "trial" : "trials"}`}
          note={`${pace.typicalLastHour.toFixed(1)} usually at this hour`}
        />
        <Figure
          label="Rate so far"
          value={`${(pace.soFar / Math.max(1, pace.minuteOfDay / 60)).toFixed(1)} an hour`}
          note={`${(pace.typicalByNow / Math.max(1, pace.minuteOfDay / 60)).toFixed(1)} on a usual day`}
        />
      </div>

      <PaceChart pace={pace} />

      <Muted>
        A usual day is the average of the last {pace.basisDays} days. The estimate scales today&apos;s count by the share
        of a day that is usually in by this time; the range is what the middle half of those days would give.
      </Muted>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <div style={{ font: "500 12px var(--font-ui)", color: "var(--ink-3)" }}>{label}</div>
      <div style={{ font: "650 18px/1.3 var(--font-ui)", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{note}</div>
    </div>
  );
}

const H = 150;
const PAD_L = 34;
const PAD_B = 22;

function PaceChart({ pace }: { pace: TrialPace }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = pace.curve;
  const nowH = pace.minuteOfDay / 60;
  const max = Math.max(pace.high, pace.projected, ...pts.map((p) => p.typical), pace.soFar, 1) * 1.05;
  const plotW = Math.max(0, w - PAD_L);
  const x = (h: number) => PAD_L + (h / 24) * plotW;
  const y = (v: number) => 6 + (1 - v / max) * (H - PAD_B - 6);

  const typicalPath = `M${x(0)},${y(0)} ` + pts.map((p) => `L${x(p.hour)},${y(p.typical)}`).join(" ");
  const todayPts = [{ h: 0, v: 0 }, ...pts.filter((p) => p.today != null && p.hour <= Math.ceil(nowH)).map((p) => ({ h: Math.min(p.hour, nowH), v: p.today! }))];
  const todayPath = todayPts.map((p, i) => `${i ? "L" : "M"}${x(p.h)},${y(p.v)}`).join(" ");
  const active = hover != null ? pts[hover - 1] : null;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = Math.round(((e.clientX - rect.left - PAD_L) / Math.max(1, plotW)) * 24);
    setHover(Math.max(1, Math.min(24, h)));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", minHeight: 22, font: "400 12px var(--font-ui)", color: "var(--ink-2)" }}>
        <Legend swatch={<line x1="0" y1="5" x2="16" y2="5" stroke="var(--chart-bar)" strokeWidth="2.5" />} label="Today" />
        <Legend swatch={<line x1="0" y1="5" x2="16" y2="5" stroke="var(--ink-4)" strokeWidth="2" strokeDasharray="3 3" />} label="A usual day" />
        <Legend swatch={<line x1="0" y1="5" x2="16" y2="5" stroke="var(--chart-bar)" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" />} label="Estimate to midnight" />
        {active && (
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
            By {clock(Math.min(active.hour * 60, 24 * 60 - 1))}: {active.today != null ? `${fmtNum(active.today)} today, ` : ""}
            {active.typical.toFixed(1)} usually
          </span>
        )}
      </div>
      <div ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ position: "relative", height: H, marginTop: 6 }}>
        {w > 0 && (
          <svg width={w} height={H} style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }} role="img" aria-label={`Trials through the day: ${pace.soFar} so far against ${pace.typicalByNow} usually by now, estimate ${pace.projected}`}>
            <line x1={PAD_L} x2={w} y1={y(0)} y2={y(0)} stroke="var(--chart-grid)" />
            <line x1={PAD_L} x2={w} y1={y(pace.typicalDay)} y2={y(pace.typicalDay)} stroke="var(--chart-grid)" strokeDasharray="2 4" />
            <text x={PAD_L - 6} y={y(pace.typicalDay) + 4} textAnchor="end" style={{ font: "400 10.5px var(--font-ui)", fill: "var(--ink-3)" }}>
              {fmtNum(pace.typicalDay)}
            </text>
            <text x={PAD_L - 6} y={y(0) + 4} textAnchor="end" style={{ font: "400 10.5px var(--font-ui)", fill: "var(--ink-3)" }}>
              0
            </text>
            <path d={typicalPath} fill="none" stroke="var(--ink-4)" strokeWidth={2} strokeDasharray="3 3" />
            <path
              d={`M${x(nowH)},${y(pace.soFar)} L${x(24)},${y(pace.projected)}`}
              fill="none"
              stroke="var(--chart-bar)"
              strokeWidth={2}
              strokeDasharray="1 4"
              strokeLinecap="round"
            />
            <path d={todayPath} fill="none" stroke="var(--chart-bar)" strokeWidth={2.5} strokeLinejoin="round" />
            <circle cx={x(nowH)} cy={y(pace.soFar)} r={4} fill="var(--chart-bar)" stroke="var(--surface)" strokeWidth={2} />
            <text x={x(24)} y={y(pace.projected) - 8} textAnchor="end" style={{ font: "600 11px var(--font-ui)", fill: "var(--ink)" }}>
              ~{fmtNum(pace.projected)}
            </text>
            {active && (
              <line x1={x(active.hour)} x2={x(active.hour)} y1={6} y2={y(0)} stroke="var(--line-2)" />
            )}
            {[0, 6, 12, 18, 24].map((h) => (
              <text
                key={h}
                x={x(h)}
                y={H - 4}
                textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
                style={{ font: "400 10.5px var(--font-ui)", fill: "var(--ink-3)" }}
              >
                {h === 0 || h === 24 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width="16" height="10" aria-hidden>
        {swatch}
      </svg>
      {label}
    </span>
  );
}
