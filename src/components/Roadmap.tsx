"use client";

/**
 * Product Roadmap tab: Now / Next / Later / Done board. Type into a column
 * to add an item, drag cards to move or reorder them, click one for details.
 * The Map view (RoadmapMap.tsx) lays the same items out on a timeline.
 * Rules (ordering, drop position, done_at, linked ticket status) live in
 * src/lib/roadmap.ts; storage in /api/roadmap.
 */
import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
import { HandoffButtons } from "./HandoffButtons";
import { Segmented } from "./porcelain";
import { RoadmapMap } from "./RoadmapMap";
import { BriefReader } from "./BriefReader";
import { APP_AREAS } from "@/lib/app-areas";
import { formatDate } from "@/lib/format";
import {
  ROADMAP_OWNERS,
  ROADMAP_PRIORITIES,
  ROADMAP_STAGES,
  STAGE_HINTS,
  STAGE_LABELS,
  briefSlugFromUrl,
  briefUrlError,
  columnItems,
  ownerColor,
  ownerEdge,
  ownerWash,
  dropPosition,
  isOverdue,
  type RoadmapItem,
  type RoadmapPriority,
  type RoadmapStage,
} from "@/lib/roadmap";

const DONE_PREVIEW = 15;
const VIEW_KEY = "dad.roadmap.view";
type RoadmapView = "board" | "map";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export function Roadmap() {
  const toast = useToast();
  const [items, setItems] = React.useState<RoadmapItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [owner, setOwner] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<RoadmapItem | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropAt, setDropAt] = React.useState<{ stage: RoadmapStage; beforeId: string | null } | null>(null);
  const [showAllDone, setShowAllDone] = React.useState(false);
  const [view, setView] = React.useState<RoadmapView>("board");
  const [briefSlug, setBriefSlug] = React.useState<string | null>(null);

  // ?brief=<slug> opens that brief over the board: the shareable brief link.
  React.useEffect(() => {
    try {
      const b = new URLSearchParams(window.location.search).get("brief");
      if (b && /^[a-z0-9-]{1,80}$/.test(b)) setBriefSlug(b);
    } catch {}
  }, []);
  const setBriefParam = (slug: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (slug) url.searchParams.set("brief", slug);
      else url.searchParams.delete("brief");
      window.history.replaceState(null, "", url.toString());
    } catch {}
  };
  const openBrief = (slug: string) => {
    setBriefSlug(slug);
    setBriefParam(slug);
  };
  const closeBrief = React.useCallback(() => {
    setBriefSlug(null);
    setBriefParam(null);
  }, []);

  // Remember Board vs Map per browser; ?view=map in the URL wins.
  React.useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("view");
      const v = fromUrl ?? window.localStorage.getItem(VIEW_KEY);
      if (v === "board" || v === "map") setView(v);
    } catch {}
  }, []);
  const pickView = (v: RoadmapView) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
      const url = new URL(window.location.href);
      url.searchParams.set("view", v);
      window.history.replaceState(null, "", url.toString());
    } catch {}
  };

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const { items } = await api<{ items: RoadmapItem[] }>("/api/roadmap");
      setItems(items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const visible = React.useMemo(
    () => (owner ? items.filter((i) => i.owner === owner) : items),
    [items, owner],
  );

  const upsert = (item: RoadmapItem) =>
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id);
      if (idx === -1) return [...prev, item];
      const next = prev.slice();
      next[idx] = item;
      return next;
    });

  const quickAdd = async (stage: RoadmapStage, title: string) => {
    try {
      const { item } = await api<{ item: RoadmapItem }>("/api/roadmap", {
        method: "POST",
        body: JSON.stringify({ title, stage, owner: owner ?? undefined }),
      });
      upsert(item);
    } catch (e) {
      toast(`Couldn't add: ${(e as Error).message}`);
    }
  };

  const move = async (id: string, stage: RoadmapStage, beforeId: string | null) => {
    const prev = items.find((i) => i.id === id);
    if (!prev) return;
    const position = dropPosition(items, stage, id, beforeId);
    if (prev.stage === stage && prev.position === position) return;
    // Optimistic: the card lands now; a failure puts it back.
    upsert({ ...prev, stage, position });
    try {
      const { item, requestError } = await api<{ item: RoadmapItem; requestError?: string }>(
        `/api/roadmap/${id}`,
        { method: "PATCH", body: JSON.stringify({ stage, position }) },
      );
      upsert(item);
      if (prev.stage !== stage) {
        toast(
          requestError
            ? `Moved to ${STAGE_LABELS[stage]}, but the linked request didn't update`
            : `Moved to ${STAGE_LABELS[stage]}`,
        );
      }
    } catch (e) {
      upsert(prev);
      toast(`Couldn't move: ${(e as Error).message}`);
    }
  };

  const reschedule = async (id: string, target_date: string) => {
    const prev = items.find((i) => i.id === id);
    if (!prev || prev.target_date === target_date) return;
    upsert({ ...prev, target_date });
    try {
      const { item } = await api<{ item: RoadmapItem }>(`/api/roadmap/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ target_date }),
      });
      upsert(item);
      toast(`Target set to ${formatDate(`${target_date}T12:00:00`)}`);
    } catch (e) {
      upsert(prev);
      toast(`Couldn't reschedule: ${(e as Error).message}`);
    }
  };

  const onDrop = () => {
    if (dragId && dropAt) move(dragId, dropAt.stage, dropAt.beforeId);
    setDragId(null);
    setDropAt(null);
  };

  const openCount = items.filter((i) => i.stage !== "done").length;

  return (
    <>
      <PageHeader
        eyebrow="Product · Planning"
        title={<em>Roadmap</em>}
        subtitle={
          view === "map"
            ? "When things are due and what's coming. Drag a diamond to reschedule, drag an unscheduled item onto a day to date it."
            : "What we're building now, next and later. Type in a column to add, drag to move, click a card for details."
        }
        actions={
          <Button variant="primary" icon={<Icons.Plus />} onClick={() => setCreating(true)}>
            Add item
          </Button>
        }
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 18 }}>
        <span style={labelStyle}>Owner</span>
        <Chip tone={!owner ? "ink" : "neutral"} onClick={() => setOwner(null)}>
          Everyone
        </Chip>
        {ROADMAP_OWNERS.map((o) => {
          const color = ownerColor(o)!;
          const on = owner === o;
          return (
            <Chip
              key={o}
              onClick={() => setOwner(on ? null : o)}
              style={{
                background: on ? color : ownerWash(o),
                color: on ? "var(--on-solid)" : color,
                borderColor: on ? color : ownerEdge(o),
              }}
            >
              {o}
            </Chip>
          );
        })}
        <span style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 8 }}>
          {openCount} open
        </span>
        <span style={{ flex: 1 }} />
        <Segmented
          size="sm"
          value={view}
          onChange={(v) => pickView(v as RoadmapView)}
          options={[
            { value: "board", label: "Board" },
            { value: "map", label: "Map" },
          ]}
        />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--ink-3)" }}>
          <div className="serif" style={{ fontSize: 20 }}>
            Loading roadmap…
          </div>
        </div>
      ) : view === "map" ? (
        <RoadmapMap items={visible} onOpen={setSelected} onReschedule={reschedule} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
            alignItems: "start",
          }}
        >
          {ROADMAP_STAGES.map((stage) => {
            let col = columnItems(visible, stage);
            const hidden = stage === "done" && !showAllDone ? Math.max(0, col.length - DONE_PREVIEW) : 0;
            if (hidden) col = col.slice(0, DONE_PREVIEW);
            return (
              <Column
                key={stage}
                stage={stage}
                items={col}
                total={columnItems(visible, stage).length}
                dragId={dragId}
                dropAt={dropAt}
                onDragStart={setDragId}
                onDragEnd={() => {
                  setDragId(null);
                  setDropAt(null);
                }}
                onDragOverAt={setDropAt}
                onDrop={onDrop}
                onOpen={setSelected}
                onQuickAdd={(t) => quickAdd(stage, t)}
                footer={
                  hidden > 0 ? (
                    <button onClick={() => setShowAllDone(true)} style={linkButton}>
                      Show {hidden} older
                    </button>
                  ) : null
                }
              />
            );
          })}
        </div>
      )}

      {(selected || creating) && (
        <RoadmapDrawer
          item={creating ? null : selected}
          defaultOwner={owner}
          onClose={() => {
            setSelected(null);
            setCreating(false);
          }}
          onSaved={(item) => {
            upsert(item);
            setSelected(null);
            setCreating(false);
          }}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((i) => i.id !== id));
            setSelected(null);
          }}
          onOpenBrief={openBrief}
        />
      )}

      {briefSlug && <BriefReader slug={briefSlug} onClose={closeBrief} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Column + card

function Column({
  stage,
  items,
  total,
  dragId,
  dropAt,
  onDragStart,
  onDragEnd,
  onDragOverAt,
  onDrop,
  onOpen,
  onQuickAdd,
  footer,
}: {
  stage: RoadmapStage;
  items: RoadmapItem[];
  total: number;
  dragId: string | null;
  dropAt: { stage: RoadmapStage; beforeId: string | null } | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverAt: (at: { stage: RoadmapStage; beforeId: string | null }) => void;
  onDrop: () => void;
  onOpen: (item: RoadmapItem) => void;
  onQuickAdd: (title: string) => void;
  footer: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState("");
  const endTarget = !!dragId && dropAt?.stage === stage && dropAt.beforeId === null;

  return (
    <section
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        // Over empty column space: drop at the end.
        if (e.target === e.currentTarget) onDragOverAt({ stage, beforeId: null });
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 160,
        outline: endTarget ? "2px solid color-mix(in oklab, var(--accent) 45%, transparent)" : "none",
      }}
    >
      <header
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          onDragOverAt({ stage, beforeId: items[0]?.id ?? null });
        }}
        style={{ padding: "4px 4px 2px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {STAGE_LABELS[stage]}{" "}
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--ink-3)" }}>{total}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{STAGE_HINTS[stage]}</div>
        </div>
      </header>

      {stage !== "done" && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onQuickAdd(draft.trim());
              setDraft("");
            }
          }}
          placeholder={`Add to ${STAGE_LABELS[stage]}… (Enter)`}
          aria-label={`Add to ${STAGE_LABELS[stage]}`}
          style={{ ...inputStyle, padding: "8px 10px", fontSize: 12, background: "var(--surface)" }}
        />
      )}

      {items.map((item) => (
        <Card
          key={item.id}
          item={item}
          dragging={dragId === item.id}
          dropBefore={!!dragId && dragId !== item.id && dropAt?.stage === stage && dropAt.beforeId === item.id}
          onDragStart={() => onDragStart(item.id)}
          onDragEnd={onDragEnd}
          onDragOver={() => onDragOverAt({ stage, beforeId: item.id })}
          onOpen={() => onOpen(item)}
        />
      ))}

      {items.length === 0 && (
        <div style={{ padding: "18px 8px", textAlign: "center", fontSize: 12, color: "var(--ink-4)" }}>
          {stage === "done" ? "Nothing shipped yet" : "Nothing here"}
        </div>
      )}
      {footer}
    </section>
  );
}

function Card({
  item,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOver,
  onOpen,
}: {
  item: RoadmapItem;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onOpen: () => void;
}) {
  const overdue = isOverdue(item);
  const color = ownerColor(item.owner);
  const edge = ownerEdge(item.owner);
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onClick={onOpen}
      style={{
        textAlign: "left",
        width: "100%",
        background: ownerWash(item.owner),
        border: `1px solid ${edge}`,
        borderTop: dropBefore ? "3px solid var(--accent)" : `1px solid ${edge}`,
        borderRadius: 10,
        padding: "10px 12px",
        cursor: "grab",
        color: "var(--ink)",
        opacity: dragging ? 0.4 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.4,
          textDecoration: item.stage === "done" ? "line-through" : "none",
          color: item.stage === "done" ? "var(--ink-3)" : "var(--ink)",
        }}
      >
        {item.title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {item.priority === "high" && item.stage !== "done" && <Chip tone="accent">High</Chip>}
        {item.area && <Chip tone="neutral">{item.area}</Chip>}
        {item.feature_request_id && (
          <span title="From a feature request" style={{ display: "inline-flex", color: "var(--ink-3)" }}>
            <Icons.Flag size={12} />
          </span>
        )}
        {item.brief_url && (
          <span
            title="Has a brief: open the card to read it"
            style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--ink-2)" }}
          >
            <Icons.Bookmark size={12} /> Brief
          </span>
        )}
        <span style={{ flex: 1 }} />
        {item.target_date && item.stage !== "done" && (
          <span style={{ fontSize: 11, color: overdue ? "var(--accent)" : "var(--ink-3)" }}>
            {overdue ? "Overdue · " : ""}
            {formatDate(`${item.target_date}T12:00:00`)}
          </span>
        )}
        {item.stage === "done" && item.done_at && (
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{formatDate(item.done_at)}</span>
        )}
        {item.owner && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              height: 20,
              padding: "0 8px",
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: color ?? "var(--surface-2)",
              border: `1px solid ${color ?? "var(--line)"}`,
              color: color ? "var(--on-solid)" : "var(--ink-2)",
            }}
          >
            {item.owner}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Drawer

function RoadmapDrawer({
  item,
  defaultOwner,
  onClose,
  onSaved,
  onDeleted,
  onOpenBrief,
}: {
  item: RoadmapItem | null;
  defaultOwner: string | null;
  onClose: () => void;
  onSaved: (item: RoadmapItem) => void;
  onDeleted: (id: string) => void;
  onOpenBrief: (slug: string) => void;
}) {
  const toast = useToast();
  const isCreate = item === null;
  const [title, setTitle] = React.useState(item?.title ?? "");
  const [notes, setNotes] = React.useState(item?.notes ?? "");
  const [stage, setStage] = React.useState<RoadmapStage>(item?.stage ?? "next");
  const [priority, setPriority] = React.useState<RoadmapPriority>(item?.priority ?? "normal");
  const [area, setArea] = React.useState(item?.area ?? "");
  const [owner, setOwner] = React.useState(item?.owner ?? defaultOwner ?? "");
  const [target, setTarget] = React.useState(item?.target_date ?? "");
  const [briefUrl, setBriefUrl] = React.useState(item?.brief_url ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const save = async () => {
    if (!title.trim()) {
      setError("Title required");
      return;
    }
    const briefError = briefUrlError(briefUrl);
    if (briefError) {
      setError(briefError);
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      title: title.trim(),
      notes,
      stage,
      priority,
      area: area || null,
      owner: owner || null,
      target_date: target || null,
      brief_url: briefUrl.trim() || null,
    };
    try {
      const { item: saved } = await api<{ item: RoadmapItem }>(
        isCreate ? "/api/roadmap" : `/api/roadmap/${item!.id}`,
        { method: isCreate ? "POST" : "PATCH", body: JSON.stringify(body) },
      );
      onSaved(saved);
      toast(isCreate ? "Added to roadmap" : "Saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!item) return;
    if (!window.confirm("Delete this roadmap item? This can't be undone.")) return;
    setSaving(true);
    try {
      await api(`/api/roadmap/${item.id}`, { method: "DELETE" });
      onDeleted(item.id);
      toast("Deleted");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={() => !saving && onClose()}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklab, var(--ink) 30%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 100,
          animation: "fadeIn 200ms ease",
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 560,
          maxWidth: "92vw",
          background: "var(--surface)",
          boxShadow: "var(--shadow-drawer)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 280ms cubic-bezier(.4,0,.2,1)",
        }}
      >
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div className="serif" style={{ fontSize: 20 }}>
            {isCreate ? "New roadmap item" : "Roadmap item"}
          </div>
          <button onClick={onClose} aria-label="Close" style={iconButton}>
            <Icons.Close size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fix the community word filter"
              style={inputStyle}
              autoFocus={isCreate}
            />
          </Field>

          {item?.brief_url && <BriefLink url={item.brief_url} onOpenBrief={onOpenBrief} />}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Stage">
              <select value={stage} onChange={(e) => setStage(e.target.value as RoadmapStage)} style={inputStyle}>
                {ROADMAP_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as RoadmapPriority)} style={inputStyle}>
                {ROADMAP_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Owner">
              <select value={owner} onChange={(e) => setOwner(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {ROADMAP_OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Target date">
              <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Area">
            <select value={area} onChange={(e) => setArea(e.target.value)} style={inputStyle}>
              <option value="">None</option>
              {APP_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              {area && !APP_AREAS.includes(area) && <option value={area}>{area}</option>}
            </select>
          </Field>

          <Field label="Brief link">
            <input
              value={briefUrl}
              onChange={(e) => setBriefUrl(e.target.value)}
              placeholder="https://… (a DAD brief link or any page)"
              style={inputStyle}
              inputMode="url"
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What needs to happen, links, decisions…"
              style={{ ...inputStyle, minHeight: 160, resize: "vertical", lineHeight: 1.5 }}
            />
          </Field>

          {item?.feature_request_id && (
            <a
              href={`/?tab=requests&request=${encodeURIComponent(item.feature_request_id)}`}
              style={{ fontSize: 12, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icons.Flag size={14} /> Open the feature request this came from
            </a>
          )}
          {item && (
            <HandoffButtons
              kind="roadmap"
              id={item.id}
              blockedReason={
                title !== item.title ||
                notes !== item.notes ||
                stage !== item.stage ||
                priority !== item.priority ||
                area !== (item.area ?? "") ||
                owner !== (item.owner ?? "") ||
                target !== (item.target_date ?? "") ||
                briefUrl !== (item.brief_url ?? "")
                  ? "Save first, so the post includes your edits"
                  : null
              }
            />
          )}
          {item && (
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
              Added {formatDate(item.created_at)}
              {item.done_at ? ` · done ${formatDate(item.done_at)}` : ""}
            </div>
          )}

          {error && <ErrorBox>{error}</ErrorBox>}
        </div>

        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            {!isCreate && (
              <Button variant="danger" icon={<Icons.Trash />} onClick={del} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : isCreate ? "Add" : "Save"}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

/** The card's brief: a DAD brief opens in place, any other page in a new tab. */
function BriefLink({ url, onOpenBrief }: { url: string; onOpenBrief: (slug: string) => void }) {
  const slug = briefSlugFromUrl(url, typeof window === "undefined" ? "" : window.location.host);
  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--line))",
    background: "color-mix(in oklab, var(--accent) 7%, var(--surface))",
    color: "var(--ink)",
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    fontFamily: "inherit",
  };
  const label = (
    <>
      <Icons.Bookmark size={15} />
      <span style={{ flex: 1 }}>Read the brief</span>
      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{slug ? "opens here" : "opens in a new tab"}</span>
    </>
  );
  return slug ? (
    <button type="button" onClick={() => onOpenBrief(slug)} style={style}>
      {label}
    </button>
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" style={style}>
      {label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// bits

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "9px 12px",
        fontSize: 12,
        color: "var(--accent)",
        background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
        border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--font-geist-mono), monospace",
  color: "var(--ink-3)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--ink)",
  outline: "none",
};

const iconButton: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: "transparent",
  border: "1px solid transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const linkButton: React.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 12,
  color: "var(--ink-3)",
  cursor: "pointer",
  padding: 6,
};
