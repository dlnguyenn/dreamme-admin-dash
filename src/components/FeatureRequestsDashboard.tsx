"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip } from "./ui";
import { Icons } from "./Icons";
import { FeatureRequestDrawer } from "./FeatureRequestDrawer";
import { API } from "@/lib/supabase";
import { formatRelative } from "@/lib/format";
import type { FeatureRequest, FeatureRequestStatus } from "@/lib/types";

const STATUS_FILTERS: Array<"all" | FeatureRequestStatus> = [
  "all",
  "new",
  "planned",
  "in_progress",
  "shipped",
  "declined",
];

const STATUS_LABELS: Record<FeatureRequestStatus, string> = {
  new: "New",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  declined: "Declined",
};

const STATUS_TONES: Record<
  FeatureRequestStatus,
  "neutral" | "ink" | "accent" | "success"
> = {
  new: "accent",
  planned: "ink",
  in_progress: "ink",
  shipped: "success",
  declined: "neutral",
};

export function FeatureRequestsDashboard() {
  const [rows, setRows] = React.useState<FeatureRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | FeatureRequestStatus>(
    "all",
  );
  const [epicFilter, setEpicFilter] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<FeatureRequest | null>(null);
  const [creating, setCreating] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const data = await API.fetchFeatureRequests();
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const epics = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.epic) set.add(r.epic);
    return Array.from(set).sort();
  }, [rows]);

  const visible = React.useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (epicFilter && r.epic !== epicFilter) return false;
      return true;
    });
  }, [rows, filter, epicFilter]);

  const onSaved = (saved: FeatureRequest) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    setSelected(null);
    setCreating(false);
  };

  const onDeleted = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelected(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Triage"
        title={<em>Feature Requests</em>}
        subtitle="User-submitted product asks from the DreamMe app. Edit status, epic, and details inline."
        tint="color-mix(in oklab, var(--p-emma) 45%, transparent)"
        actions={
          <Button
            variant="primary"
            icon={<Icons.Plus />}
            onClick={() => setCreating(true)}
          >
            Add request
          </Button>
        }
      />

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background:
              "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {STATUS_FILTERS.map((s) => {
          const active = filter === s;
          const label = s === "all" ? "All" : STATUS_LABELS[s];
          const count = counts[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                borderRadius: 999,
                border: "1px solid",
                borderColor: active ? "var(--ink)" : "var(--line)",
                background: active ? "var(--ink)" : "var(--surface)",
                color: active ? "var(--surface)" : "var(--ink-2)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {label}
              <span
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                  padding: "0 4px",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {epics.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 24,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--ink-4)",
              marginRight: 4,
            }}
          >
            Epic
          </span>
          <Chip
            tone={!epicFilter ? "ink" : "neutral"}
            onClick={() => setEpicFilter(null)}
          >
            All
          </Chip>
          {epics.map((e) => (
            <Chip
              key={e}
              tone={epicFilter === e ? "ink" : "neutral"}
              onClick={() => setEpicFilter(epicFilter === e ? null : e)}
            >
              {e}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div
          style={{ padding: 60, textAlign: "center", color: "var(--ink-3)" }}
        >
          <div className="serif" style={{ fontSize: 20, fontStyle: "italic" }}>
            Loading requests…
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line)",
            borderRadius: 14,
            color: "var(--ink-3)",
          }}
        >
          <div
            className="serif"
            style={{ fontSize: 22, fontStyle: "italic", marginBottom: 6 }}
          >
            Nothing here yet
          </div>
          <div style={{ fontSize: 13 }}>
            Requests arrive via <code>POST /api/ingest/feature-request</code> or
            the Add button.
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--surface)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 140px 160px 120px",
              padding: "10px 16px",
              borderBottom: "1px solid var(--line)",
              background: "var(--surface-2)",
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--ink-4)",
            }}
          >
            <div>Created</div>
            <div>Title</div>
            <div>Epic</div>
            <div>Submitter</div>
            <div>Status</div>
          </div>
          {visible.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 140px 160px 120px",
                padding: "14px 16px",
                borderBottom: "1px solid var(--line)",
                background: "transparent",
                border: "none",
                borderRadius: 0,
                cursor: "pointer",
                textAlign: "left",
                color: "var(--ink)",
                alignItems: "center",
                fontSize: 13,
                width: "100%",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--surface-2)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {formatRelative(r.createdAt)}
              </div>
              <div
                style={{
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  paddingRight: 12,
                }}
              >
                {r.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {r.epic ?? "—"}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  paddingRight: 12,
                }}
              >
                {r.submitterEmail ?? "—"}
              </div>
              <div>
                <Chip tone={STATUS_TONES[r.status]}>
                  {STATUS_LABELS[r.status]}
                </Chip>
              </div>
            </button>
          ))}
        </div>
      )}

      {(selected || creating) && (
        <FeatureRequestDrawer
          request={creating ? null : selected}
          epics={epics}
          onClose={() => {
            setSelected(null);
            setCreating(false);
          }}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
