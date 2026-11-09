import { describe, expect, it } from "vitest";
import { endPosition, sectionDue, sectionItems, type PlanTodo } from "@/lib/revenue-plan/todos";

const t = (over: Partial<PlanTodo>): PlanTodo => ({
  id: over.title ?? "x",
  section: "today",
  title: "x",
  note: "",
  due_date: null,
  position: 1,
  done: false,
  done_at: null,
  created_at: "2026-11-09T00:00:00Z",
  updated_at: "2026-11-09T00:00:00Z",
  ...over,
});

describe("plan todos", () => {
  const todos = [
    t({ title: "b", position: 2 }),
    t({ title: "a", position: 1, done: true }),
    t({ title: "c", position: 3 }),
    t({ title: "w", section: "week", position: 1, due_date: "2026-11-13" }),
  ];

  it("lists open items in order, then done ones, per section", () => {
    expect(sectionItems(todos, "today").map((x) => x.title)).toEqual(["b", "c", "a"]);
    expect(sectionItems(todos, "week").map((x) => x.title)).toEqual(["w"]);
    expect(sectionItems(todos, "month")).toEqual([]);
  });

  it("adds new items after the last one in their section", () => {
    expect(endPosition(todos, "today")).toBe(4);
    expect(endPosition(todos, "month")).toBe(1);
  });

  it("labels a section with its latest due date", () => {
    expect(sectionDue(todos, "week")).toBe("Fri, Nov 13");
    expect(sectionDue(todos, "month")).toBeNull();
  });
});
