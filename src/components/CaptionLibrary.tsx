"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, Chip, PersonaChip, useCopy, useToast } from "./ui";
import { PageHeader } from "./Shell";
import { CharCount } from "./CharCount";
import { useIsMobile } from "@/lib/useIsMobile";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { formatRelative } from "@/lib/format";
import { API } from "@/lib/supabase";
import type { DashState, SavedCaption } from "@/lib/types";

type Filter = "all" | PersonaId | "starred" | "posted";

export function CaptionLibrary({
  state,
  setState,
  gridSize,
  refresh,
}: {
  state: DashState;
  setState: React.Dispatch<React.SetStateAction<DashState>>;
  gridSize: number;
  refresh: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const toast = useToast();
  const { copy } = useCopy();
  const isMobile = useIsMobile();
  const filterStripRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll active filter chip into view on mobile when filter changes
  React.useEffect(() => {
    if (!isMobile || !filterStripRef.current) return;
    const active = filterStripRef.current.querySelector<HTMLButtonElement>(
      "[data-filter-active='true']",
    );
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [filter, isMobile]);

  const update = async (id: string, patch: Partial<SavedCaption>) => {
    setState((s) => ({
      ...s,
      savedCaptions: s.savedCaptions.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    }));
    try {
      await API.updateCaption(id, patch);
    } catch (e) {
      toast(`Sync failed — ${(e as Error).message}`);
      refresh();
    }
  };

  const remove = async (id: string) => {
    setState((s) => ({
      ...s,
      savedCaptions: s.savedCaptions.filter((c) => c.id !== id),
    }));
    try {
      await API.deleteCaption(id);
    } catch (e) {
      toast(`Delete failed — ${(e as Error).message}`);
      refresh();
    }
  };

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.savedCaptions
      .filter((c) => {
        if (q && !c.caption.toLowerCase().includes(q)) return false;
        if (filter === "all") return true;
        if (filter === "starred") return c.starred;
        if (filter === "posted") return c.posted;
        return c.personaId === filter;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [state.savedCaptions, query, filter]);

  const filters: Array<{
    id: Filter;
    label: string;
    count: number;
    icon?: React.ReactNode;
  }> = [
    { id: "all", label: "All", count: state.savedCaptions.length },
    ...PERSONA_IDS.map((pid) => ({
      id: pid as Filter,
      label: PERSONAS[pid].name,
      count: state.savedCaptions.filter((c) => c.personaId === pid).length,
    })),
    {
      id: "starred",
      label: "Starred",
      count: state.savedCaptions.filter((c) => c.starred).length,
      icon: <Icons.Star size={12} />,
    },
    {
      id: "posted",
      label: "Posted",
      count: state.savedCaptions.filter((c) => c.posted).length,
      icon: <Icons.Check size={12} />,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title={
          <>
            <span style={{ fontStyle: "italic" }}>Caption</span> library
          </>
        }
        subtitle="Every caption you've saved from the content pipeline, searchable and editable. Star the keepers; mark what's been posted so you don't double-use."
        tint="color-mix(in oklab, var(--p-emma) 40%, transparent)"
      />

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: isMobile ? 16 : 24,
          flexWrap: "wrap",
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: isMobile ? "1 1 auto" : "1 1 300px",
            width: isMobile ? "100%" : undefined,
            maxWidth: isMobile ? "100%" : 420,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <Icons.Search size={16} stroke="var(--ink-4)" />
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search captions…"
            style={{
              width: "100%",
              padding: "10px 14px 10px 40px",
              fontSize: 13,
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              borderRadius: 10,
              outline: "none",
            }}
          />
        </div>
        <div
          ref={filterStripRef}
          className={isMobile ? "mobile-hscroll" : undefined}
          style={{
            display: "flex",
            gap: 6,
            flexWrap: isMobile ? "nowrap" : "wrap",
            overflowX: isMobile ? "auto" : "visible",
            width: isMobile ? "100%" : undefined,
            scrollSnapType: isMobile ? "x proximity" : undefined,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {filters.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                data-filter-active={active ? "true" : undefined}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 500,
                  background: active ? "var(--ink)" : "var(--surface)",
                  color: active ? "var(--surface)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ink)" : "var(--line-2)"}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  flexShrink: isMobile ? 0 : undefined,
                  scrollSnapAlign: isMobile ? "center" : undefined,
                  whiteSpace: "nowrap",
                }}
              >
                {f.icon}
                {f.label}
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10,
                    opacity: 0.7,
                  }}
                >
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "var(--ink-3)",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
            background: "var(--surface)",
          }}
        >
          <Icons.Message size={32} stroke="var(--ink-4)" />
          <div
            className="serif"
            style={{ fontSize: 22, fontStyle: "italic", marginTop: 14 }}
          >
            {state.savedCaptions.length === 0
              ? "No captions saved yet."
              : "Nothing matches."}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {state.savedCaptions.length === 0
              ? "Click any image in the Content Pipeline → Save to library."
              : "Try a different search or filter."}
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "1fr"
            : `repeat(${Math.max(1, gridSize - 1)}, 1fr)`,
          gap: isMobile ? 12 : 16,
        }}
      >
        {filtered.map((c) => {
          const persona = PERSONAS[c.personaId];
          if (!persona) return null;
          const isEditing = editingId === c.id;
          const currentText = isEditing ? draft : c.caption;
          return (
            <article
              key={c.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 16,
                padding: isMobile ? "16px 14px 12px" : "18px 20px 16px",
                display: "flex",
                flexDirection: "column",
                transition:
                  "box-shadow 200ms ease, transform 200ms ease",
                boxShadow: "var(--shadow-sm)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: persona.color,
                  opacity: 0.7,
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  gap: 8,
                }}
              >
                <PersonaChip persona={persona} size="sm" />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {c.posted && (
                    <Chip tone="success">
                      <Icons.Check size={10} /> Posted
                    </Chip>
                  )}
                  <button
                    onClick={() => update(c.id, { starred: !c.starred })}
                    title={c.starred ? "Unstar" : "Star"}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 4,
                      borderRadius: 6,
                      display: "flex",
                    }}
                  >
                    {c.starred ? (
                      <Icons.StarFilled size={16} stroke="var(--accent)" />
                    ) : (
                      <Icons.Star size={16} stroke="var(--ink-4)" />
                    )}
                  </button>
                </div>
              </div>

              {!isEditing ? (
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: "var(--ink-2)",
                    flex: 1,
                    display: "-webkit-box",
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    whiteSpace: "pre-wrap",
                    marginBottom: 12,
                  }}
                >
                  {c.caption}
                </div>
              ) : (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  style={{
                    width: "100%",
                    minHeight: 180,
                    padding: 10,
                    fontSize: 13,
                    lineHeight: 1.65,
                    fontFamily: "var(--font-geist), sans-serif",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line-2)",
                    borderRadius: 8,
                    resize: "vertical",
                    outline: "none",
                    marginBottom: 12,
                  }}
                />
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                  paddingTop: 10,
                  borderTop: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <CharCount chars={currentText.length} limit={4000} />
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ink-4)",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  >
                    {formatRelative(c.createdAt)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {!isEditing ? (
                    <>
                      <IconBtn
                        title="Copy"
                        onClick={() => {
                          copy(c.caption);
                          toast("Copied to clipboard");
                        }}
                      >
                        <Icons.Copy size={14} />
                      </IconBtn>
                      <IconBtn
                        title="Edit"
                        onClick={() => {
                          setEditingId(c.id);
                          setDraft(c.caption);
                        }}
                      >
                        <Icons.Edit size={14} />
                      </IconBtn>
                      <IconBtn
                        title={c.posted ? "Unmark posted" : "Mark as posted"}
                        active={c.posted}
                        onClick={() => {
                          update(c.id, { posted: !c.posted });
                          toast(c.posted ? "Unmarked" : "Marked as posted");
                        }}
                      >
                        <Icons.Check size={14} />
                      </IconBtn>
                      <IconBtn
                        title="Remove from library"
                        onClick={() => {
                          if (confirm("Remove from library?")) {
                            remove(c.id);
                            toast("Removed");
                          }
                        }}
                      >
                        <Icons.Close size={14} />
                      </IconBtn>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          update(c.id, { caption: draft });
                          setEditingId(null);
                          toast("Saved");
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  const isMobile = useIsMobile();
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: isMobile ? 36 : 30,
        height: isMobile ? 36 : 30,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active
          ? "color-mix(in oklab, var(--p-olivia) 25%, var(--surface))"
          : hover
            ? "var(--surface-2)"
            : "transparent",
        border: `1px solid ${
          active
            ? "color-mix(in oklab, var(--p-olivia) 40%, var(--line))"
            : "var(--line)"
        }`,
        color: active
          ? "color-mix(in oklab, var(--p-olivia) 60%, var(--ink))"
          : "var(--ink-2)",
      }}
    >
      {children}
    </button>
  );
}
