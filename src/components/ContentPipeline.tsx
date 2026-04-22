"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, Chip, useToast } from "./ui";
import { PageHeader } from "./Shell";
import { ContentCard } from "./ContentCard";
import { DetailDrawer } from "./DetailDrawer";
import { WebhookModal } from "./WebhookModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModifyImageModal } from "./ModifyImageModal";
import { useCopy } from "./ui";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { formatRelative } from "@/lib/format";
import { API } from "@/lib/supabase";
import type { DashState, Delivery } from "@/lib/types";

export function ContentPipeline({
  state,
  setState,
  gridSize,
  refresh,
  syncError,
}: {
  state: DashState;
  setState: React.Dispatch<React.SetStateAction<DashState>>;
  gridSize: number;
  refresh: () => void;
  syncError: string | null;
}) {
  const [tab, setTab] = React.useState<"all" | PersonaId>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [webhookOpen, setWebhookOpen] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [modifyingId, setModifyingId] = React.useState<string | null>(null);
  const toast = useToast();
  const { copy } = useCopy();

  const copyItemLink = (id: string) => {
    const url = `${window.location.origin}/item/${id}`;
    copy(url);
    toast("Link copied");
  };

  const deleteItem = async (id: string) => {
    const prev = state.items;
    setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
    if (selectedId === id) setSelectedId(null);
    try {
      await API.deleteDelivery(id);
      toast("Delivery deleted");
    } catch (e) {
      setState((s) => ({ ...s, items: prev }));
      toast(`Delete failed — ${(e as Error).message}`);
    }
  };

  const selected = state.items.find((x) => x.id === selectedId) ?? null;

  const updateItem = async (id: string, patch: Partial<Delivery>) => {
    setState((s) => ({
      ...s,
      items: s.items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
    try {
      await API.updateDelivery(id, patch);
    } catch (e) {
      toast(`Sync failed — ${(e as Error).message}`);
      refresh();
    }
  };

  const filtered = React.useMemo(() => {
    const arr =
      tab === "all" ? state.items : state.items.filter((x) => x.personaId === tab);
    return arr
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [state.items, tab]);

  const grouped = React.useMemo(() => {
    const g: Record<string, Delivery[]> = {};
    filtered.forEach((x) => {
      const k = formatRelative(x.createdAt);
      if (!g[k]) g[k] = [];
      g[k].push(x);
    });
    return g;
  }, [filtered]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: state.items.length };
    PERSONA_IDS.forEach((pid) => {
      c[pid] = state.items.filter((x) => x.personaId === pid).length;
    });
    return c;
  }, [state.items]);

  const saveCaptionToLibrary = async (item: Delivery) => {
    const exists = state.savedCaptions.some((c) => c.sourceItemId === item.id);
    if (exists) {
      toast("Already in caption library");
      return;
    }
    try {
      const entry = await API.saveCaption(item);
      setState((s) => ({
        ...s,
        savedCaptions: [entry, ...s.savedCaptions],
        items: s.items.map((x) =>
          x.id === item.id ? { ...x, inLibrary: true } : x,
        ),
      }));
      toast("Saved to caption library");
    } catch (e) {
      toast(`Save failed — ${(e as Error).message}`);
    }
  };

  const tabsDef: Array<{ id: "all" | PersonaId; label: string; personaId: PersonaId | null }> = [
    { id: "all", label: "All", personaId: null },
    ...PERSONA_IDS.map((pid) => ({
      id: pid,
      label: PERSONAS[pid].name,
      personaId: pid,
    })),
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard · 01"
        title={
          <>
            <span style={{ fontStyle: "italic" }}>Daily</span> content pipeline
          </>
        }
        subtitle="Every morning, the n8n workflow drops three images and a long-form caption here — one per persona. Click an image to see its companion caption and save it to the library."
        tint="color-mix(in oklab, var(--p-andrea) 40%, transparent)"
        actions={
          <>
            {syncError && (
              <Chip tone="accent" title={syncError}>
                Sync error
              </Chip>
            )}
            <Button
              variant="secondary"
              onClick={() => refresh()}
              title="Refresh now"
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              icon={<Icons.Webhook />}
              onClick={() => setWebhookOpen(true)}
            >
              n8n setup
            </Button>
          </>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
        {[
          { label: "Total deliveries", value: state.items.length, accent: null },
          {
            label: "This week",
            value: state.items.filter(
              (x) =>
                Date.now() - new Date(x.createdAt).getTime() < 7 * 86400000,
            ).length,
            accent: null,
          },
          { label: "In library", value: state.savedCaptions.length, accent: "var(--accent)" },
          {
            label: "Marked posted",
            value: state.items.filter((x) => x.posted).length,
            accent: "var(--p-olivia)",
          },
        ].map((s, i) => (
          <div key={i} style={{ background: "var(--surface)", padding: "18px 20px" }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--ink-4)",
              }}
            >
              {s.label}
            </div>
            <div
              className="serif"
              style={{
                fontSize: 32,
                fontWeight: 400,
                letterSpacing: "-0.02em",
                marginTop: 4,
                color: s.accent || "var(--ink)",
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 28,
          padding: 5,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          width: "fit-content",
        }}
      >
        {tabsDef.map((t) => {
          const active = tab === t.id;
          const persona = t.personaId ? PERSONAS[t.personaId] : null;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 14px 7px 10px",
                borderRadius: 8,
                border: "none",
                background: active ? "var(--surface)" : "transparent",
                boxShadow: active ? "var(--shadow-sm)" : "none",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                cursor: "pointer",
              }}
            >
              {persona ? (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: persona.color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                  }}
                >
                  {persona.avatar}
                </span>
              ) : (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background:
                      "linear-gradient(135deg, var(--p-andrea), var(--p-emma), var(--p-olivia))",
                  }}
                />
              )}
              {t.label}
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--ink-3)",
                  padding: "1px 6px",
                  background: active ? "var(--bg-2)" : "transparent",
                  borderRadius: 4,
                }}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {Object.keys(grouped).length === 0 && (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "var(--ink-3)",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
          }}
        >
          <div
            className="serif"
            style={{ fontSize: 22, fontStyle: "italic", marginBottom: 6 }}
          >
            No deliveries yet.
          </div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            Click <strong>n8n setup</strong> above to wire the workflow to
            Supabase.
          </div>
          <Button
            variant="primary"
            onClick={() => setWebhookOpen(true)}
            icon={<Icons.Webhook />}
          >
            Show n8n config
          </Button>
        </div>
      )}

      {Object.entries(grouped).map(([dateLabel, items]) => (
        <div key={dateLabel} style={{ marginBottom: 36 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 14,
            }}
          >
            <div
              className="serif"
              style={{
                fontSize: 20,
                fontWeight: 400,
                fontStyle: "italic",
                color: "var(--ink-2)",
              }}
            >
              {dateLabel}
            </div>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <div
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              {items.length} {items.length === 1 ? "delivery" : "deliveries"}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
              gap: 18,
            }}
          >
            {items.map((item) => {
              const persona = PERSONAS[item.personaId];
              if (!persona) return null;
              return (
                <ContentCard
                  key={item.id}
                  item={item}
                  persona={persona}
                  onClick={() => setSelectedId(item.id)}
                  onToggleStar={(e) => {
                    e.stopPropagation();
                    updateItem(item.id, { starred: !item.starred });
                  }}
                  onCopyLink={(e) => {
                    e.stopPropagation();
                    copyItemLink(item.id);
                  }}
                  onDelete={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(item.id);
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}

      {selected && PERSONAS[selected.personaId] && (
        <DetailDrawer
          item={selected}
          persona={PERSONAS[selected.personaId]}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => updateItem(selected.id, patch)}
          onSaveToLibrary={() => saveCaptionToLibrary(selected)}
          onCopyLink={() => copyItemLink(selected.id)}
          onDelete={() => setConfirmDeleteId(selected.id)}
          onModifyImage={() => setModifyingId(selected.id)}
          inLibrary={
            selected.inLibrary ||
            state.savedCaptions.some((c) => c.sourceItemId === selected.id)
          }
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this delivery?"
          message="This removes the row from the content pipeline. The image file in storage is not affected."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            const id = confirmDeleteId;
            setConfirmDeleteId(null);
            deleteItem(id);
          }}
        />
      )}

      {webhookOpen && <WebhookModal onClose={() => setWebhookOpen(false)} />}

      {modifyingId && (() => {
        const target = state.items.find((x) => x.id === modifyingId);
        if (!target) return null;
        return (
          <ModifyImageModal
            item={target}
            onClose={() => setModifyingId(null)}
            onAccepted={(newUrl) => {
              setState((s) => ({
                ...s,
                items: s.items.map((x) =>
                  x.id === target.id ? { ...x, imageUrl: newUrl } : x,
                ),
              }));
              setModifyingId(null);
              refresh();
            }}
          />
        );
      })()}
    </div>
  );
}
