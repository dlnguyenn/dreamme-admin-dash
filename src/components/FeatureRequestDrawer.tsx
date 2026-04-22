"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, useToast } from "./ui";
import type { FeatureRequest, FeatureRequestStatus } from "@/lib/types";

const STATUS_OPTIONS: FeatureRequestStatus[] = [
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

export function FeatureRequestDrawer({
  request,
  epics,
  onClose,
  onSaved,
  onDeleted,
}: {
  request: FeatureRequest | null;
  epics: string[];
  onClose: () => void;
  onSaved: (row: FeatureRequest) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const isCreate = request === null;

  const [title, setTitle] = React.useState(request?.title ?? "");
  const [description, setDescription] = React.useState(
    request?.description ?? "",
  );
  const [status, setStatus] = React.useState<FeatureRequestStatus>(
    request?.status ?? "new",
  );
  const [epic, setEpic] = React.useState(request?.epic ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTitle(request?.title ?? "");
    setDescription(request?.description ?? "");
    setStatus(request?.status ?? "new");
    setEpic(request?.epic ?? "");
    setError(null);
  }, [request?.id, request?.title, request?.description, request?.status, request?.epic]);

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
    setSaving(true);
    setError(null);
    try {
      if (isCreate) {
        const res = await fetch("/api/ingest/feature-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            epic: epic.trim() || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (status !== "new" && json.id) {
          const patchRes = await fetch(`/api/feature-requests/${json.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status }),
          });
          const pj = await patchRes.json();
          if (patchRes.ok && pj.ok) {
            onSaved(mapRow(pj.row));
            toast("Request created");
            return;
          }
        }
        onSaved(mapRow(json.row));
        toast("Request created");
      } else {
        const res = await fetch(`/api/feature-requests/${request!.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            status,
            epic: epic.trim() || null,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        onSaved(mapRow(json.row));
        toast("Request updated");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!request) return;
    if (!window.confirm("Delete this request? This can't be undone.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/feature-requests/${request.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onDeleted(request.id);
      toast("Request deleted");
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
          width: 640,
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
            gap: 12,
          }}
        >
          <div
            className="serif"
            style={{ fontSize: 20, fontStyle: "italic", fontWeight: 400 }}
          >
            {isCreate ? "New request" : "Edit request"}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "transparent",
              border: "1px solid transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "22px 26px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Dark mode in the settings screen"
              style={inputStyle}
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does the user want, and why?"
              style={{ ...inputStyle, minHeight: 140, resize: "vertical", lineHeight: 1.5 }}
            />
          </Field>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as FeatureRequestStatus)
                  }
                  style={inputStyle}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Epic (free-text tag)">
                <input
                  type="text"
                  list="epic-options"
                  value={epic}
                  onChange={(e) => setEpic(e.target.value)}
                  placeholder="e.g. Accessibility"
                  style={inputStyle}
                />
                <datalist id="epic-options">
                  {epics.map((e) => (
                    <option key={e} value={e} />
                  ))}
                </datalist>
              </Field>
            </div>
          </div>

          {!isCreate && request?.submitterEmail && (
            <Field label="Submitter">
              <div
                style={{
                  ...inputStyle,
                  color: "var(--ink-3)",
                  background: "var(--surface-2)",
                }}
              >
                {request.submitterEmail}
              </div>
            </Field>
          )}

          {error && (
            <div
              style={{
                padding: "9px 12px",
                fontSize: 12,
                color: "var(--accent)",
                background:
                  "color-mix(in oklab, var(--accent) 10%, var(--surface))",
                border:
                  "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
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
              <Button
                variant="danger"
                icon={<Icons.Trash />}
                onClick={del}
                disabled={saving}
              >
                Delete
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : isCreate ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

function mapRow(row: {
  id: string;
  title: string;
  description: string;
  status: FeatureRequestStatus;
  epic: string | null;
  submitter_email: string | null;
  created_at: string;
  updated_at: string;
}): FeatureRequest {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    epic: row.epic,
    submitterEmail: row.submitter_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
