"use client";

import { HOOK_CATEGORIES, HOOK_CATEGORY_LABELS } from "@/lib/hook-categories";
import type { TikTokPost } from "@/lib/types";
import type { PersonaId } from "@/lib/personas";

const UNDEREXPLORED_THRESHOLD = 2;

// Porcelain semantic families: hot = success, mid = neutral, cold = warning.
function shadeFor(ratio: number): { bg: string; fg: string } {
  if (!ratio || !isFinite(ratio))
    return { bg: "var(--surface-2)", fg: "var(--ink-3)" };
  if (ratio >= 1.5)
    return { bg: "var(--success-soft)", fg: "var(--success-text)" };
  if (ratio >= 0.75) return { bg: "var(--surface-2)", fg: "var(--ink-2)" };
  return { bg: "var(--warning-soft)", fg: "var(--warning-text)" };
}

export function CategoryHeatStrip({
  persona,
  posts,
  windowDays = 30,
}: {
  persona: PersonaId;
  posts: TikTokPost[];
  windowDays?: number;
}) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const filtered = posts.filter(
    (p) =>
      p.personaId === persona &&
      p.postedAt &&
      Date.parse(p.postedAt) > cutoff,
  );

  const byCategory = new Map<string, { count: number; ratioSum: number }>();
  for (const p of filtered) {
    const k = p.category || "other";
    const cur = byCategory.get(k) ?? { count: 0, ratioSum: 0 };
    cur.count += 1;
    cur.ratioSum += p.performanceRatio ?? 0;
    byCategory.set(k, cur);
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
      }}
    >
      {HOOK_CATEGORIES.map((cat) => {
        const stats = byCategory.get(cat);
        const avg = stats && stats.count > 0 ? stats.ratioSum / stats.count : 0;
        const tone = shadeFor(avg);
        const isUnder = (stats?.count ?? 0) <= UNDEREXPLORED_THRESHOLD;
        return (
          <span
            key={cat}
            title={`${HOOK_CATEGORY_LABELS[cat]} — ${stats?.count ?? 0} posts in last ${windowDays}d, avg ratio ${avg.toFixed(2)}`}
            style={{
              padding: "3px 8px",
              borderRadius: 7,
              font: "700 10px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              background: isUnder ? "transparent" : tone.bg,
              color: tone.fg,
              border: isUnder
                ? `1px dashed ${tone.fg}`
                : "1px solid transparent",
            }}
          >
            {HOOK_CATEGORY_LABELS[cat]}
            {stats && stats.count > 0 ? ` ${stats.count}` : ""}
          </span>
        );
      })}
    </div>
  );
}
