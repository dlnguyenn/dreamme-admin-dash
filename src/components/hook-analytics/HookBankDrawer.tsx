"use client";

import * as React from "react";
import { Icons } from "../Icons";
import { Button, PersonaChip } from "../ui";
import { SideDrawer } from "../SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import type { GeneratedHook, TikTokPost } from "@/lib/types";
import { HookCard } from "./HookCard";

type Filter = "all" | "unused" | "used";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unused", label: "Unused" },
  { id: "used", label: "Used" },
];

export function HookBankDrawer({
  open,
  persona,
  hooks,
  postsById,
  onClose,
  onToggleUsed,
  onOpenCaption,
  onOpenInstagram,
}: {
  open: boolean;
  persona: PersonaId | null;
  hooks: GeneratedHook[];
  postsById: Map<string, TikTokPost>;
  onClose: () => void;
  onToggleUsed: (h: GeneratedHook) => void;
  onOpenCaption: (h: GeneratedHook) => void;
  onOpenInstagram: (h: GeneratedHook) => void;
}) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = React.useState<Filter>("unused");

  const filtered = React.useMemo(() => {
    if (!persona) return [];
    const own = hooks.filter((h) => h.personaId === persona);
    if (filter === "unused") return own.filter((h) => !h.used);
    if (filter === "used") return own.filter((h) => h.used);
    return own;
  }, [hooks, persona, filter]);

  const counts = React.useMemo(() => {
    if (!persona) return { all: 0, unused: 0, used: 0 };
    const own = hooks.filter((h) => h.personaId === persona);
    return {
      all: own.length,
      unused: own.filter((h) => !h.used).length,
      used: own.filter((h) => h.used).length,
    };
  }, [hooks, persona]);

  const personaMeta = persona ? PERSONAS[persona] : null;
  const padX = isMobile ? 16 : 24;
  const padY = isMobile ? 14 : 20;

  return (
    <SideDrawer open={open} onClose={onClose} ariaLabel="Hook bank" desktopWidth={720}>
      {/* Header — flexShrink: 0 so it never collapses */}
      <div
        style={{
          flexShrink: 0,
          padding: `${padY}px ${padX}px`,
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: personaMeta?.soft ?? "var(--surface)",
        }}
      >
        {personaMeta && <PersonaChip persona={personaMeta} size="sm" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="serif"
            style={{
              fontSize: isMobile ? 18 : 22,
              fontStyle: "italic",
              lineHeight: 1.2,
            }}
          >
            {personaMeta?.name ?? "—"}'s hook bank
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              marginTop: 3,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {counts.unused} active · {counts.used} used · {counts.all} total
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.Close size={16} />}
          onClick={onClose}
          aria-label="Close"
        />
      </div>

      {/* Filter chips — also flexShrink: 0 */}
      <div
        style={{
          flexShrink: 0,
          padding: `12px ${padX}px 0`,
        }}
      >
        <div
          role="tablist"
          aria-label="Filter"
          style={{
            display: "flex",
            padding: 4,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 10,
          }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count =
              f.id === "all"
                ? counts.all
                : f.id === "unused"
                  ? counts.unused
                  : counts.used;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.id)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: 7,
                  background: active ? "var(--surface)" : "transparent",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                {f.label}
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    padding: "1px 6px",
                    background: active ? "var(--bg-2)" : "transparent",
                    borderRadius: 4,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable cards body — flex: 1 + minHeight: 0 + overflow auto.
          minHeight: 0 is required so the flex child can be SMALLER than its
          content, which is what enables the scrollbar to engage. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: `12px ${padX}px ${padY + 16}px`,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              fontSize: 13,
              color: "var(--ink-4)",
              border: "1px dashed var(--line-2)",
              borderRadius: 10,
              textAlign: "center",
            }}
          >
            {filter === "unused"
              ? `No unused hooks for ${personaMeta?.name ?? "this persona"}. Generate fresh ones from the column header.`
              : filter === "used"
                ? `Nothing used yet for ${personaMeta?.name ?? "this persona"}.`
                : `No hooks for ${personaMeta?.name ?? "this persona"} yet.`}
          </div>
        ) : (
          filtered.map((h) => (
            <div key={h.id} style={{ flexShrink: 0 }}>
              <HookCard
                hook={h}
                linkedPost={
                  h.postedPostId ? postsById.get(h.postedPostId) ?? null : null
                }
                onToggleUsed={() => onToggleUsed(h)}
                onOpenCaption={() => onOpenCaption(h)}
                onOpenInstagram={() => onOpenInstagram(h)}
              />
            </div>
          ))
        )}
      </div>
    </SideDrawer>
  );
}

