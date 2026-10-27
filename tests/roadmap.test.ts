import { describe, expect, it } from "vitest";
import {
  columnItems,
  doneAtFor,
  dropPosition,
  endPosition,
  isOverdue,
  requestStatusForStage,
  todayIso,
  type RoadmapItem,
} from "@/lib/roadmap";

const item = (over: Partial<RoadmapItem>): RoadmapItem => ({
  id: "x",
  title: "t",
  notes: "",
  stage: "next",
  priority: "normal",
  area: null,
  owner: null,
  target_date: null,
  position: 0,
  feature_request_id: null,
  done_at: null,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
  ...over,
});

const board = [
  item({ id: "a", stage: "next", position: 0 }),
  item({ id: "b", stage: "next", position: 1 }),
  item({ id: "c", stage: "next", position: 2 }),
  item({ id: "n", stage: "now", position: 0 }),
  item({ id: "d1", stage: "done", done_at: "2026-10-01T00:00:00Z" }),
  item({ id: "d2", stage: "done", done_at: "2026-10-20T00:00:00Z" }),
];

describe("columnItems", () => {
  it("keeps the hand-set order in open columns", () => {
    expect(columnItems(board, "next").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks position ties by priority, high first", () => {
    const tied = [item({ id: "lo", priority: "low" }), item({ id: "hi", priority: "high" })];
    expect(columnItems(tied, "next").map((i) => i.id)).toEqual(["hi", "lo"]);
  });

  it("lists Done newest-finished first", () => {
    expect(columnItems(board, "done").map((i) => i.id)).toEqual(["d2", "d1"]);
  });
});

describe("positions", () => {
  it("appends to the end of a column, or 0 when it is empty", () => {
    expect(endPosition(board, "next")).toBe(3);
    expect(endPosition(board, "later")).toBe(0);
  });

  it("drops between two cards at their midpoint", () => {
    // move c to just before b
    expect(dropPosition(board, "next", "c", "b")).toBe(0.5);
  });

  it("drops before the first card below it", () => {
    expect(dropPosition(board, "next", "c", "a")).toBe(-1 + 0.5 * 1);
  });

  it("drops at the end when there is no card to go before", () => {
    expect(dropPosition(board, "now", "a", null)).toBe(1);
    expect(dropPosition(board, "later", "a", null)).toBe(0);
  });

  it("ignores the moving card itself when it is the last one", () => {
    expect(dropPosition(board, "next", "c", null)).toBe(2);
  });

  it("orders correctly after the drop", () => {
    const pos = dropPosition(board, "next", "c", "b");
    const moved = board.map((i) => (i.id === "c" ? { ...i, position: pos } : i));
    expect(columnItems(moved, "next").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
});

describe("doneAtFor", () => {
  const now = "2026-10-27T12:00:00Z";
  it("stamps on entering Done, keeps it while there, clears on leaving", () => {
    expect(doneAtFor("now", "done", null, now)).toBe(now);
    expect(doneAtFor("done", "done", "2026-10-01T00:00:00Z", now)).toBe("2026-10-01T00:00:00Z");
    expect(doneAtFor("done", "next", "2026-10-01T00:00:00Z", now)).toBeNull();
    expect(doneAtFor(null, "next", null, now)).toBeNull();
  });
});

describe("linked feature request status", () => {
  it("follows the stage", () => {
    expect(requestStatusForStage("now")).toBe("in_progress");
    expect(requestStatusForStage("next")).toBe("planned");
    expect(requestStatusForStage("later")).toBe("planned");
    expect(requestStatusForStage("done")).toBe("shipped");
  });
});

describe("isOverdue", () => {
  it("flags open items past their target date only", () => {
    const today = "2026-10-27";
    expect(isOverdue(item({ target_date: "2026-10-26" }), today)).toBe(true);
    expect(isOverdue(item({ target_date: "2026-10-27" }), today)).toBe(false);
    expect(isOverdue(item({ target_date: "2026-10-26", stage: "done" }), today)).toBe(false);
    expect(isOverdue(item({}), today)).toBe(false);
  });

  it("formats today as a local YYYY-MM-DD", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
