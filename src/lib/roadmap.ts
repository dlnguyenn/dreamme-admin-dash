/**
 * Product Roadmap tab: shared types and the pure rules (ordering, drop
 * position, what a stage change does). Pure, so the client board and the
 * API routes agree and the rules are unit-tested.
 */
import type { FeatureRequestStatus } from "@/lib/types";

export type RoadmapStage = "now" | "next" | "later" | "done";
export type RoadmapPriority = "high" | "normal" | "low";

export const ROADMAP_STAGES: RoadmapStage[] = ["now", "next", "later", "done"];
export const ROADMAP_PRIORITIES: RoadmapPriority[] = ["high", "normal", "low"];

export const STAGE_LABELS: Record<RoadmapStage, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  done: "Done",
};

export const STAGE_HINTS: Record<RoadmapStage, string> = {
  now: "Being built",
  next: "Up after that",
  later: "Worth doing, not soon",
  done: "Shipped",
};

/** Who an item can be assigned to. Always shown in full: both start with D. */
export const ROADMAP_OWNERS = ["Dan", "David"];

/** Each owner's color (teal, plum): clear of the terracotta on High chips. */
const OWNER_COLORS: Record<string, string> = {
  Dan: "var(--cat-6)",
  David: "var(--cat-4)",
};

export function ownerColor(owner: string | null): string | null {
  return (owner && OWNER_COLORS[owner]) || null;
}

/** Card background: a light wash of the owner's color. */
export function ownerWash(owner: string | null): string {
  const color = ownerColor(owner);
  return color ? `color-mix(in srgb, ${color} 9%, var(--surface))` : "var(--surface)";
}

/** Card border, tinted to match. */
export function ownerEdge(owner: string | null): string {
  const color = ownerColor(owner);
  return color ? `color-mix(in srgb, ${color} 35%, var(--line))` : "var(--line)";
}

export interface RoadmapItem {
  id: string;
  title: string;
  notes: string;
  stage: RoadmapStage;
  priority: RoadmapPriority;
  area: string | null;
  owner: string | null;
  /** YYYY-MM-DD */
  target_date: string | null;
  position: number;
  feature_request_id: string | null;
  /** Link to the item's brief: a DAD brief (?tab=roadmap&brief=<slug>) or any http(s) page. */
  brief_url: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Trimmed brief link, or null when empty. */
export function normalizeBriefUrl(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/** Why a brief link is refused, or null when it's fine (empty is fine). */
export function briefUrlError(v: string | null | undefined): string | null {
  const s = normalizeBriefUrl(v);
  if (!s) return null;
  if (s.length > 1000) return "Brief link is too long";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "Brief link must start with https://";
  } catch {
    return "Brief link must be a full URL (https://…)";
  }
  return null;
}

/**
 * The DAD brief a link opens (…?tab=roadmap&brief=<slug> on this site), so
 * the Roadmap can show it in place. Null for any other page.
 */
export function briefSlugFromUrl(url: string | null, host: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, `https://${host}`);
    if (u.host !== host) return null;
    const slug = u.searchParams.get("brief");
    return slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/** The shareable link to a DAD brief. */
export function briefLink(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/?tab=roadmap&brief=${encodeURIComponent(slug)}`;
}

/**
 * The brief to show on a Feature Requests ticket: the first brief link on
 * the roadmap items made from it. A DAD brief opens in place on the Roadmap
 * (same tab); any other page opens in a new tab. Null when no item has one.
 */
export function ticketBriefTarget(
  items: RoadmapItem[] | null,
  host: string,
): { href: string; newTab: boolean } | null {
  const url = normalizeBriefUrl(items?.find((i) => normalizeBriefUrl(i.brief_url))?.brief_url);
  if (!url || briefUrlError(url)) return null;
  const slug = briefSlugFromUrl(url, host);
  return slug
    ? { href: `/?tab=roadmap&brief=${encodeURIComponent(slug)}`, newTab: false }
    : { href: url, newTab: true };
}

const PRIORITY_RANK: Record<RoadmapPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * Items for one column. Open stages follow the hand-set order (drag to
 * reorder); Done is newest-finished first, since nobody reorders history.
 */
export function columnItems(items: RoadmapItem[], stage: RoadmapStage): RoadmapItem[] {
  const col = items.filter((i) => i.stage === stage);
  if (stage === "done") {
    return col.sort((a, b) =>
      (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at),
    );
  }
  return col.sort(
    (a, b) =>
      a.position - b.position ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.created_at.localeCompare(b.created_at),
  );
}

/** Position that lands a card at the end of a column. */
export function endPosition(items: RoadmapItem[], stage: RoadmapStage): number {
  const col = items.filter((i) => i.stage === stage);
  return col.length ? Math.max(...col.map((i) => i.position)) + 1 : 0;
}

/**
 * Position for a card dropped into `stage` just before `beforeId` (or at the
 * end when null): the midpoint of its new neighbours, so nothing else moves.
 */
export function dropPosition(
  items: RoadmapItem[],
  stage: RoadmapStage,
  movingId: string,
  beforeId: string | null,
): number {
  const col = columnItems(
    items.filter((i) => i.id !== movingId),
    stage,
  );
  if (!beforeId) return col.length ? col[col.length - 1].position + 1 : 0;
  const idx = col.findIndex((i) => i.id === beforeId);
  if (idx === -1) return col.length ? col[col.length - 1].position + 1 : 0;
  const after = col[idx].position;
  const before = idx > 0 ? col[idx - 1].position : after - 1;
  return (before + after) / 2;
}

/** done_at is stamped on entering Done and cleared on leaving it. */
export function doneAtFor(
  prevStage: RoadmapStage | null,
  nextStage: RoadmapStage,
  prevDoneAt: string | null,
  now: string = new Date().toISOString(),
): string | null {
  if (nextStage !== "done") return null;
  return prevStage === "done" ? prevDoneAt : now;
}

/**
 * A linked Feature Requests ticket's status follows its roadmap item, so the
 * Requests tab shows what's happening without anyone updating it twice.
 */
export function requestStatusForStage(stage: RoadmapStage): FeatureRequestStatus {
  if (stage === "now") return "in_progress";
  if (stage === "done") return "shipped";
  return "planned";
}

/** Today in YYYY-MM-DD (local), for overdue checks. */
export function todayIso(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function isOverdue(item: RoadmapItem, today: string = todayIso()): boolean {
  return item.stage !== "done" && !!item.target_date && item.target_date < today;
}
