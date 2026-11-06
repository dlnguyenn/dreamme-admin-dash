import { describe, expect, it } from "vitest";
import type { RoadmapItem } from "@/lib/roadmap";
import {
  dayToIso,
  isoToDay,
  itemSpan,
  mapLanes,
  mapRange,
  mondayOf,
  trajectory,
  weekday,
} from "@/lib/roadmap-map";

const item = (over: Partial<RoadmapItem>): RoadmapItem => ({
  id: Math.random().toString(36).slice(2),
  title: "t",
  notes: "",
  stage: "next",
  priority: "normal",
  area: null,
  owner: null,
  target_date: null,
  brief_url: null,
  position: 0,
  feature_request_id: null,
  done_at: null,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
  ...over,
});

// Thursday 2026-11-05
const TODAY = isoToDay("2026-11-05");

describe("day math", () => {
  it("round-trips YYYY-MM-DD", () => {
    expect(dayToIso(isoToDay("2026-11-05"))).toBe("2026-11-05");
    expect(isoToDay("2026-11-06") - isoToDay("2026-11-05")).toBe(1);
  });
  it("weeks start Monday", () => {
    expect(weekday(TODAY)).toBe(3);
    expect(dayToIso(mondayOf(TODAY))).toBe("2026-11-02");
    expect(dayToIso(mondayOf(isoToDay("2026-11-08")))).toBe("2026-11-02"); // Sunday
  });
});

describe("mapRange", () => {
  it("defaults to two weeks back, twelve ahead, Monday-aligned", () => {
    const r = mapRange([], TODAY);
    expect(dayToIso(r.start)).toBe("2026-10-19");
    expect(weekday(r.start)).toBe(0);
    expect(weekday(r.end)).toBe(0);
    expect(r.end).toBeGreaterThan(TODAY + 84);
  });
  it("stretches to cover far-off and long-overdue targets", () => {
    const r = mapRange(
      [item({ target_date: "2027-06-01" }), item({ target_date: "2026-08-01" })],
      TODAY,
    );
    expect(r.start).toBeLessThanOrEqual(isoToDay("2026-07-25"));
    expect(r.end).toBeGreaterThan(isoToDay("2027-06-14"));
  });
  it("ignores done items' targets", () => {
    const r = mapRange([item({ stage: "done", target_date: "2025-01-01" })], TODAY);
    expect(dayToIso(r.start)).toBe("2026-10-19");
  });
});

describe("itemSpan", () => {
  it("open with no date is unscheduled", () => {
    expect(itemSpan(item({}), TODAY)).toBeNull();
  });
  it("future target: bar from added to target, not late", () => {
    const s = itemSpan(item({ target_date: "2026-11-12" }), TODAY);
    expect(s).toMatchObject({ kind: "scheduled", target: isoToDay("2026-11-12"), overdueTo: null });
  });
  it("past target runs late to today", () => {
    const s = itemSpan(item({ target_date: "2026-11-03" }), TODAY);
    expect(s).toMatchObject({ kind: "scheduled", overdueTo: TODAY });
  });
  it("a target before it was added starts the bar at the target", () => {
    const s = itemSpan(item({ target_date: "2026-10-20" }), TODAY);
    expect(s && s.kind === "scheduled" && s.from).toBe(isoToDay("2026-10-20"));
  });
  it("done sits where it finished", () => {
    const s = itemSpan(item({ stage: "done", done_at: "2026-11-03T15:00:00Z" }), TODAY);
    expect(s).toMatchObject({ kind: "done" });
  });
});

describe("mapLanes", () => {
  const range = mapRange([], TODAY);
  it("splits dated from unscheduled and orders lanes Now/Next/Later/Done", () => {
    const items = [
      item({ title: "b", stage: "next", target_date: "2026-11-20" }),
      item({ title: "a", stage: "next", target_date: "2026-11-12" }),
      item({ title: "n", stage: "now", target_date: "2026-11-30" }),
      item({ title: "u", stage: "later" }),
      item({ title: "uh", stage: "later", priority: "high" }),
      item({ title: "old", stage: "done", done_at: "2025-01-01T00:00:00Z" }),
    ];
    const { lanes, unscheduled } = mapLanes(items, "stage", TODAY, range);
    expect(lanes.map((l) => l.key)).toEqual(["now", "next"]);
    expect(lanes[1].rows.map((r) => r.item.title)).toEqual(["a", "b"]);
    expect(unscheduled.map((i) => i.title)).toEqual(["uh", "u"]);
  });
  it("groups by owner with Unassigned last", () => {
    const items = [
      item({ owner: null, target_date: "2026-11-12" }),
      item({ owner: "David", target_date: "2026-11-12" }),
      item({ owner: "Dan", target_date: "2026-11-12" }),
    ];
    const { lanes } = mapLanes(items, "owner", TODAY, range);
    expect(lanes.map((l) => l.label)).toEqual(["Dan", "David", "Unassigned"]);
  });
});

describe("trajectory", () => {
  it("counts overdue, this week (to Sunday), next 30, unscheduled, next up", () => {
    const t = trajectory(
      [
        item({ title: "late", target_date: "2026-11-01" }),
        item({ title: "sun", target_date: "2026-11-08" }),
        item({ title: "soon", target_date: "2026-11-06" }),
        item({ title: "month", target_date: "2026-11-30" }),
        item({ title: "far", target_date: "2027-02-01" }),
        item({ title: "nodate" }),
        item({ title: "shipped", stage: "done", target_date: "2026-11-06" }),
      ],
      TODAY,
    );
    expect(t).toMatchObject({ overdue: 1, thisWeek: 2, next30: 3, unscheduled: 1 });
    expect(t.nextUp?.title).toBe("soon");
  });
});
