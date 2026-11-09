/**
 * April Plan > Todo: Dan's plan action items, ticked off by hand. Shared
 * types and pure rules for the view and /api/plan/todos. Storage: plan_todos
 * (migration 0107), so ticks follow Dan across computers.
 */

export type TodoSection = "today" | "week" | "month";
export const TODO_SECTIONS: TodoSection[] = ["today", "week", "month"];

export const SECTION_LABELS: Record<TodoSection, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

export interface PlanTodo {
  id: string;
  section: TodoSection;
  title: string;
  note: string;
  /** YYYY-MM-DD */
  due_date: string | null;
  position: number;
  done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A section's items: open ones first in their order, then done ones. */
export function sectionItems(todos: PlanTodo[], section: TodoSection): PlanTodo[] {
  return todos
    .filter((t) => t.section === section)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position || a.created_at.localeCompare(b.created_at));
}

/** Position for a new item: after everything in its section. */
export function endPosition(todos: PlanTodo[], section: TodoSection): number {
  const inSection = todos.filter((t) => t.section === section).map((t) => t.position);
  return inSection.length ? Math.max(...inSection) + 1 : 1;
}

/** "by Fri, Nov 13": the latest due date among a section's items. */
export function sectionDue(todos: PlanTodo[], section: TodoSection): string | null {
  const dates = todos.filter((t) => t.section === section && t.due_date).map((t) => t.due_date as string);
  if (!dates.length) return null;
  const last = dates.sort().at(-1)!;
  return new Date(`${last}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
