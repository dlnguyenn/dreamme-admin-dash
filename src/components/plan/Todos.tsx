"use client";

/**
 * April Plan > Todo: Dan's action items for the plan, ticked off by hand.
 * Three sections (today, this week, this month). Ticks are saved to
 * plan_todos via /api/plan/todos, so they show on every computer.
 * Rules: src/lib/revenue-plan/todos.ts.
 */

import * as React from "react";
import { Card, ErrorBanner } from "../porcelain";
import { Icons } from "../Icons";
import {
  SECTION_LABELS,
  TODO_SECTIONS,
  sectionDue,
  sectionItems,
  type PlanTodo,
  type TodoSection,
} from "@/lib/revenue-plan/todos";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export function Todos() {
  const [todos, setTodos] = React.useState<PlanTodo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<{ todos: PlanTodo[] }>("/api/plan/todos")
      .then((b) => setTodos(b.todos))
      .catch((e) => setError((e as Error).message));
  }, []);

  const replace = (t: PlanTodo) => setTodos((prev) => (prev ?? []).map((x) => (x.id === t.id ? t : x)));

  const toggle = async (t: PlanTodo) => {
    const optimistic = { ...t, done: !t.done, done_at: !t.done ? new Date().toISOString() : null };
    replace(optimistic);
    try {
      const { todo } = await api<{ todo: PlanTodo }>(`/api/plan/todos/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !t.done }),
      });
      replace(todo);
      setError(null);
    } catch (e) {
      replace(t);
      setError(`Couldn't save that tick: ${(e as Error).message}`);
    }
  };

  const remove = async (t: PlanTodo) => {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    try {
      await api(`/api/plan/todos/${t.id}`, { method: "DELETE" });
      setTodos((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    } catch (e) {
      setError(`Couldn't delete: ${(e as Error).message}`);
    }
  };

  const add = async (section: TodoSection, title: string) => {
    const { todo } = await api<{ todo: PlanTodo }>("/api/plan/todos", {
      method: "POST",
      body: JSON.stringify({ title, section }),
    });
    setTodos((prev) => [...(prev ?? []), todo]);
  };

  if (error && !todos) return <ErrorBanner>Couldn&apos;t load the todo list: {error}</ErrorBanner>;
  if (!todos) {
    return (
      <Card>
        <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>Loading the todo list…</div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {TODO_SECTIONS.map((section) => (
        <Section
          key={section}
          section={section}
          items={sectionItems(todos, section)}
          due={sectionDue(todos, section)}
          onToggle={toggle}
          onDelete={remove}
          onAdd={(title) => add(section, title)}
        />
      ))}
    </div>
  );
}

function Section({
  section,
  items,
  due,
  onToggle,
  onDelete,
  onAdd,
}: {
  section: TodoSection;
  items: PlanTodo[];
  due: string | null;
  onToggle: (t: PlanTodo) => void;
  onDelete: (t: PlanTodo) => void;
  onAdd: (title: string) => Promise<void>;
}) {
  const done = items.filter((t) => t.done).length;
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  const submit = async () => {
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    setAddError(null);
    try {
      await onAdd(title);
      setDraft("");
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card pad="16px 18px 12px">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ font: "650 15px var(--font-ui)", margin: 0, color: "var(--ink)" }}>{SECTION_LABELS[section]}</h3>
        {section !== "today" && due && (
          <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>by {due}</span>
        )}
        <span
          style={{
            marginLeft: "auto",
            font: "600 12px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: items.length && done === items.length ? "var(--success-text)" : "var(--ink-3)",
          }}
        >
          {done} of {items.length} done
        </span>
      </div>

      {items.length === 0 && (
        <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-4)", padding: "6px 0 10px" }}>Nothing here yet.</div>
      )}
      {items.map((t, i) => (
        <Row key={t.id} todo={t} first={i === 0} onToggle={() => onToggle(t)} onDelete={() => onDelete(t)} />
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, paddingTop: 10, borderTop: "1px solid var(--line)" }}
      >
        <Icons.Plus size={15} style={{ color: "var(--ink-4)", flex: "none" }} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${SECTION_LABELS[section].toLowerCase()}…`}
          aria-label={`Add an item to ${SECTION_LABELS[section]}`}
          disabled={saving}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            font: "400 13.5px var(--font-ui)",
            color: "var(--ink)",
            padding: "6px 0",
          }}
        />
        {draft.trim() && (
          <button
            type="submit"
            disabled={saving}
            style={{
              border: "1px solid var(--line-2)",
              background: "var(--surface)",
              borderRadius: 8,
              padding: "5px 12px",
              font: "600 12.5px var(--font-ui)",
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            {saving ? "Adding…" : "Add"}
          </button>
        )}
      </form>
      {addError && <div style={{ font: "400 12px var(--font-ui)", color: "var(--danger-text)", marginTop: 4 }}>{addError}</div>}
    </Card>
  );
}

function Row({
  todo,
  first,
  onToggle,
  onDelete,
}: {
  todo: PlanTodo;
  first: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "10px 0",
        borderTop: first ? "none" : "1px solid var(--line)",
      }}
    >
      <button
        role="checkbox"
        aria-checked={todo.done}
        aria-label={`${todo.done ? "Untick" : "Tick"} ${todo.title}`}
        onClick={onToggle}
        style={{
          flex: "none",
          width: 20,
          height: 20,
          marginTop: 1,
          borderRadius: 6,
          border: todo.done ? "1.5px solid var(--success)" : "1.5px solid var(--line-2)",
          background: todo.done ? "var(--success)" : "var(--surface)",
          color: "var(--on-solid)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "background 120ms ease, border-color 120ms ease",
        }}
      >
        {todo.done && <Icons.Check size={13} strokeWidth={3} />}
      </button>
      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={onToggle}>
        <div
          style={{
            font: "600 14px/1.4 var(--font-ui)",
            color: todo.done ? "var(--ink-4)" : "var(--ink)",
            textDecoration: todo.done ? "line-through" : "none",
          }}
        >
          {todo.title}
        </div>
        {todo.note && (
          <div
            style={{
              font: "400 12.5px/1.5 var(--font-ui)",
              color: todo.done ? "var(--ink-4)" : "var(--ink-3)",
              marginTop: 2,
              overflowWrap: "anywhere",
            }}
          >
            {todo.note}
          </div>
        )}
        {todo.done && todo.done_at && (
          <div style={{ font: "400 11px var(--font-ui)", color: "var(--ink-4)", marginTop: 3 }}>
            Done{" "}
            {new Date(todo.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
      <button
        aria-label={`Delete ${todo.title}`}
        title="Delete"
        onClick={onDelete}
        style={{
          flex: "none",
          border: "none",
          background: "transparent",
          color: "var(--ink-4)",
          cursor: "pointer",
          padding: 4,
          borderRadius: 6,
          opacity: hover ? 1 : 0.35,
          transition: "opacity 120ms ease",
        }}
      >
        <Icons.Trash size={14} />
      </button>
    </div>
  );
}
