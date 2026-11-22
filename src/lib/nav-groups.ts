"use client";

import * as React from "react";

/**
 * Collapsible sidebar groups (Home / Content / Growth / Product / Support).
 *
 * In NAV_ITEMS a `group` label sits only on the first item of each run. That
 * item can drop out of what's rendered (viewer role hides adminOnly items, an
 * alert moves an item to the top, the mobile More sheet skips tabs that have a
 * bottom-bar slot), so membership is worked out from the full ordered list,
 * never from the filtered one.
 */

export interface GroupableItem<Id extends string = string> {
  id: Id;
  group?: string;
}

export interface NavGroup<T> {
  group: string;
  items: T[];
}

/** Items before the first labelled item fall under this (none today). */
export const UNGROUPED = "";

/** id → group label, walking the full ordered nav list. */
export function navGroupMap<Id extends string>(
  all: readonly GroupableItem<Id>[],
): Map<Id, string> {
  const map = new Map<Id, string>();
  let current = UNGROUPED;
  for (const item of all) {
    if (item.group) current = item.group;
    map.set(item.id, current);
  }
  return map;
}

/**
 * Split `visible` (any subset of `all`, in display order) into groups in the
 * order they first appear. Groups with no visible items are left out.
 */
export function groupNavItems<T extends GroupableItem>(
  visible: readonly T[],
  all: readonly GroupableItem<T["id"]>[],
): NavGroup<T>[] {
  const map = navGroupMap(all);
  const out: NavGroup<T>[] = [];
  const byGroup = new Map<string, NavGroup<T>>();
  for (const item of visible) {
    const g = map.get(item.id) ?? UNGROUPED;
    let bucket = byGroup.get(g);
    if (!bucket) {
      bucket = { group: g, items: [] };
      byGroup.set(g, bucket);
      out.push(bucket);
    }
    bucket.items.push(item);
  }
  return out;
}

/**
 * What a group shows: everything when expanded; when collapsed, only the
 * current tab (so the page you're on never disappears from the nav).
 */
export function itemsToShow<T extends GroupableItem>(
  items: readonly T[],
  collapsed: boolean,
  currentId: string,
): T[] {
  return collapsed ? items.filter((i) => i.id === currentId) : [...items];
}

export const NAV_COLLAPSED_KEY = "dreamme.navCollapsed";

/** Parse the stored value; anything malformed reads as "nothing collapsed". */
export function parseCollapsed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Collapsed group labels, persisted to localStorage["dreamme.navCollapsed"].
 * Read after mount (like the other dreamme.* keys in App.tsx) so server and
 * first client render match. Shared by the desktop Sidebar and the mobile
 * More sheet, so a group folded on one stays folded on the other.
 */
export function useNavCollapsed(): {
  isCollapsed: (group: string) => boolean;
  toggle: (group: string) => void;
} {
  const [collapsed, setCollapsed] = React.useState<string[]>([]);

  React.useEffect(() => {
    try {
      setCollapsed(parseCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY)));
    } catch {
      /* storage blocked: start expanded */
    }
  }, []);

  const toggle = React.useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(group)
        ? prev.filter((g) => g !== group)
        : [...prev, group];
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: state still works for this visit */
      }
      return next;
    });
  }, []);

  const isCollapsed = React.useCallback(
    (group: string) => collapsed.includes(group),
    [collapsed],
  );

  return { isCollapsed, toggle };
}
