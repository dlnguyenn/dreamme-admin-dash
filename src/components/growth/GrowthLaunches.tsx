"use client";

/**
 * Growth AI · New Launches — Motion's sprint view: creatives grouped by
 * launch week (true 56d first appearance), weekly cadence vs an editable
 * target, and a goal-achievement chip per creative.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { type GrowthData, type AdAgg, aggregateAds, safeDiv } from "./data";
import { fmtUSD, fmtInt, SectionLabel, StatusDot, Thumb, EmptyState } from "./shared";

const TARGET_KEY = "dreamme.growth.launchTarget";
const GOAL_KEY = "dreamme.growth.launchGoal";

interface LaunchGoal {
  cpt: number;
  minTrials: number;
}

const GOAL_DEFAULT: LaunchGoal = { cpt: 40, minTrials: 3 };

type Achievement = "hit" | "promising" | "no_trials" | "testing";

const ACHIEVEMENT_META: Record<Achievement, { label: string; tone: string }> = {
  hit: { label: "Hit", tone: "var(--accent-2)" },
  promising: { label: "Promising", tone: "var(--p-emma)" },
  no_trials: { label: "No trials", tone: "var(--accent)" },
  testing: { label: "Testing", tone: "var(--ink-4)" },
};

function achievementOf(a: AdAgg, goal: LaunchGoal): Achievement {
  const cpt = safeDiv(a.spend, a.trial_starts);
  if (a.trial_starts >= goal.minTrials && Number.isFinite(cpt) && cpt < goal.cpt) return "hit";
  if (a.trial_starts >= 1 && Number.isFinite(cpt) && cpt < goal.cpt) return "promising";
  if (a.spend >= 50 && a.trial_starts === 0) return "no_trials";
  return "testing";
}

/** Monday of the ISO week containing the given YYYY-MM-DD. */
function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function fmtWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function GrowthLaunches({
  data,
  onOpenAd,
}: {
  data: GrowthData;
  onOpenAd: (adId: string) => void;
}) {
  const isMobile = useIsMobile();
  const [target, setTarget] = React.useState(5);
  const [goal, setGoal] = React.useState<LaunchGoal>(GOAL_DEFAULT);

  React.useEffect(() => {
    try {
      const t = Number(localStorage.getItem(TARGET_KEY));
      if (t >= 1 && t <= 50) setTarget(t);
      const g = localStorage.getItem(GOAL_KEY);
      if (g) setGoal({ ...GOAL_DEFAULT, ...(JSON.parse(g) as Partial<LaunchGoal>) });
    } catch {}
  }, []);

  const setTargetPersist = (t: number) => {
    const v = Math.max(1, Math.min(50, t));
    setTarget(v);
    try {
      localStorage.setItem(TARGET_KEY, String(v));
    } catch {}
  };

  const setGoalPersist = (g: LaunchGoal) => {
    setGoal(g);
    try {
      localStorage.setItem(GOAL_KEY, JSON.stringify(g));
    } catch {}
  };

  // Lifetime-in-window (56d) aggregates + group by launch week.
  const weeks = React.useMemo(() => {
    const full = aggregateAds(data.rows);
    const byWeek = new Map<string, AdAgg[]>();
    for (const a of full.values()) {
      const first = data.firstSeen.get(a.ad_id) ?? a.first_seen;
      const wk = weekStartOf(first);
      const list = byWeek.get(wk) ?? [];
      list.push(a);
      byWeek.set(wk, list);
    }
    return [...byWeek.entries()]
      .map(([week, ads]) => ({ week, ads: ads.sort((a, b) => b.spend - a.spend) }))
      .sort((a, b) => (a.week < b.week ? 1 : -1));
  }, [data.rows, data.firstSeen]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <GoalEditor
          label="Weekly launch target"
          value={target}
          suffix="creatives"
          onChange={(v) => setTargetPersist(v)}
        />
        <GoalEditor
          label="Goal · cost per trial under"
          value={goal.cpt}
          prefix="$"
          onChange={(v) => setGoalPersist({ ...goal, cpt: Math.max(1, v) })}
        />
        <GoalEditor
          label="with at least"
          value={goal.minTrials}
          suffix="trials"
          onChange={(v) => setGoalPersist({ ...goal, minTrials: Math.max(1, v) })}
        />
      </div>

      {weeks.length === 0 ? (
        <EmptyState title="No launches in the last 8 weeks." />
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          {weeks.map(({ week, ads }) => (
            <div key={week}>
              <SectionLabel
                right={
                  <LaunchProgress count={ads.length} target={target} />
                }
              >
                Week of {fmtWeek(week)} · {ads.length} launched
              </SectionLabel>
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 14,
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-sm)",
                  overflow: "hidden",
                }}
              >
                {ads.map((a, i) => {
                  const ach = ACHIEVEMENT_META[achievementOf(a, goal)];
                  const cpt = safeDiv(a.spend, a.trial_starts);
                  return (
                    <div
                      key={a.ad_id}
                      onClick={() => onOpenAd(a.ad_id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: isMobile ? "10px 12px" : "10px 16px",
                        borderTop: i === 0 ? "none" : "1px solid var(--line)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <Thumb src={a.thumbnail} name={a.ad_name} size={36} radius={7} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          title={a.ad_name}
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.ad_name || a.ad_id}
                        </div>
                        <div style={{ marginTop: 2 }}>
                          <StatusDot status={a.effective_status} />
                        </div>
                      </div>
                      {!isMobile && (
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-geist-mono), monospace",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            padding: "3px 9px",
                            borderRadius: 999,
                            color: `color-mix(in oklab, ${ach.tone} 75%, var(--ink))`,
                            background: `color-mix(in oklab, ${ach.tone} 14%, var(--surface))`,
                            border: `1px solid color-mix(in oklab, ${ach.tone} 30%, var(--line))`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ach.label}
                        </span>
                      )}
                      <div style={{ textAlign: "right", minWidth: 76 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {fmtUSD(a.spend)}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>lifetime</div>
                      </div>
                      <div style={{ textAlign: "right", minWidth: 56 }}>
                        <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtInt(a.trial_starts)}</div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>trials</div>
                      </div>
                      {!isMobile && (
                        <div style={{ textAlign: "right", minWidth: 70 }}>
                          <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                            {Number.isFinite(cpt) ? fmtUSD(cpt) : "—"}
                          </div>
                          <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>/trial</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LaunchProgress({ count, target }: { count: number; target: number }) {
  const met = count >= target;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", gap: 3 }}>
        {Array.from({ length: Math.min(target, 10) }, (_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: i < count ? (met ? "var(--accent-2)" : "var(--ink-2)") : "var(--line-2)",
            }}
          />
        ))}
      </span>
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          color: met ? "var(--accent-2)" : "var(--ink-4)",
        }}
      >
        {count}/{target}
      </span>
    </span>
  );
}

function GoalEditor({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-3)" }}>
      {label}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 8px",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        {prefix && <span style={{ color: "var(--ink-3)" }}>{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 1)}
          style={{
            width: 44,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--ink)",
            fontSize: 13,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            textAlign: "center",
          }}
        />
        {suffix && <span style={{ color: "var(--ink-4)", fontSize: 11 }}>{suffix}</span>}
      </span>
    </label>
  );
}
