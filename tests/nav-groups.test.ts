import { describe, expect, it } from "vitest";
import {
  groupNavItems,
  itemsToShow,
  navGroupMap,
  parseCollapsed,
} from "@/lib/nav-groups";

// Vitest here only transforms .ts (no JSX), so Shell.tsx can't be imported.
// This fixture copies the shape that matters in NAV_ITEMS: the group label
// sits on the first item of each run, and several of those heads are
// admin-only (overview, spend, roadmap, support).
interface Item { id: string; group?: string; adminOnly?: boolean }
const NAV_ITEMS: Item[] = [
  { id: "overview", adminOnly: true, group: "Home" },
  { id: "knowledge", adminOnly: true },
  { id: "content", group: "Content" },
  { id: "captions" },
  { id: "spy", adminOnly: true },
  { id: "hooks" },
  { id: "resources" },
  { id: "spend", adminOnly: true, group: "Growth" },
  { id: "aso", adminOnly: true },
  { id: "competitor-ads", adminOnly: true },
  { id: "roadmap", adminOnly: true, group: "Product" },
  { id: "experiments", adminOnly: true },
  { id: "support", adminOnly: true, group: "Support" },
  { id: "reviews", adminOnly: true },
];
const visibleNavItems = (viewAs: "admin" | "user") =>
  viewAs === "admin" ? NAV_ITEMS : NAV_ITEMS.filter((n) => !n.adminOnly);

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("nav groups", () => {
  it("gives every nav item a group, starting from the first labelled item", () => {
    const map = navGroupMap(NAV_ITEMS);
    expect(map.size).toBe(NAV_ITEMS.length);
    expect(map.get("knowledge")).toBe("Home");
    expect(map.get("competitor-ads")).toBe("Growth");
    expect(map.get("reviews")).toBe("Support");
    for (const g of map.values()) expect(g).not.toBe("");
  });

  it("admin sees the groups in nav order", () => {
    const groups = groupNavItems(visibleNavItems("admin"), NAV_ITEMS);
    expect(groups.map((g) => g.group)).toEqual(["Home", "Content", "Growth", "Product", "Support"]);
  });

  it("viewer keeps group membership even though the label-carrying items are admin-only", () => {
    const groups = groupNavItems(visibleNavItems("user"), NAV_ITEMS);
    // Only the Content group has viewer-visible tabs today.
    expect(groups.map((g) => g.group)).toEqual(["Content"]);
    expect(groups.flatMap((g) => g.items).every((i) => !i.adminOnly)).toBe(true);
  });

  it("an item that loses its group head (alert pin / More-sheet exclusion) stays in its group", () => {
    const visible = visibleNavItems("admin").filter((n) => n.id !== "support" && n.id !== "overview");
    const groups = groupNavItems(visible, NAV_ITEMS);
    expect(ids(groups.find((g) => g.group === "Support")!.items)).toEqual(["reviews"]);
    expect(ids(groups.find((g) => g.group === "Home")!.items)).toEqual(["knowledge"]);
    // reviews must not leak into Product
    expect(ids(groups.find((g) => g.group === "Product")!.items)).not.toContain("reviews");
  });

  it("a collapsed group still shows the current tab", () => {
    const growth = groupNavItems(visibleNavItems("admin"), NAV_ITEMS).find((g) => g.group === "Growth")!;
    expect(ids(itemsToShow(growth.items, true, "aso"))).toEqual(["aso"]);
    expect(itemsToShow(growth.items, true, "content")).toEqual([]);
    expect(itemsToShow(growth.items, false, "content")).toHaveLength(growth.items.length);
  });

  it("parses stored state defensively", () => {
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed("not json")).toEqual([]);
    expect(parseCollapsed('{"a":1}')).toEqual([]);
    expect(parseCollapsed('["Growth", 3, "Product"]')).toEqual(["Growth", "Product"]);
  });
});
