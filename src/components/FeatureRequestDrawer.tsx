"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { Button, Chip, useToast } from "./ui";
import { formatDate } from "@/lib/format";
import type {
  FeatureRequest,
  FeatureRequestDetails,
  FeatureRequestStatus,
} from "@/lib/types";

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

const KIND_LABELS: Record<string, string> = {
  feature: "New feature",
  improvement: "Improvement",
  bug: "Bug",
  content: "Content",
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
  /** close: false keeps the drawer open (inline status, regenerate) */
  onSaved: (row: FeatureRequest, opts?: { close?: boolean }) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const isCreate = request === null;
  // Existing tickets open read-first; the form is one click away.
  const [editing, setEditing] = React.useState(isCreate);

  const [title, setTitle] = React.useState(request?.title ?? "");
  const [description, setDescription] = React.useState(
    request?.description ?? "",
  );
  const [status, setStatus] = React.useState<FeatureRequestStatus>(
    request?.status ?? "new",
  );
  const [epic, setEpic] = React.useState(request?.epic ?? "");
  const [saving, setSaving] = React.useState(false);
  const [briefing, setBriefing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTitle(request?.title ?? "");
    setDescription(request?.description ?? "");
    setStatus(request?.status ?? "new");
    setEpic(request?.epic ?? "");
    setError(null);
  }, [request?.id, request?.title, request?.description, request?.status, request?.epic]);

  const busy = saving || briefing;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/feature-requests/${request!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return mapRow(json.row);
  };

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
        const row = await patch({
          title: title.trim(),
          description: description.trim(),
          status,
          epic: epic.trim() || null,
        });
        onSaved(row, { close: false });
        setEditing(false);
        toast("Request updated");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (next: FeatureRequestStatus) => {
    if (!request || next === request.status) return;
    setStatus(next);
    setSaving(true);
    setError(null);
    try {
      onSaved(await patch({ status: next }), { close: false });
      toast(`Marked ${STATUS_LABELS[next].toLowerCase()}`);
    } catch (e) {
      setStatus(request.status);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (!request) return;
    setBriefing(true);
    setError(null);
    try {
      const res = await fetch(`/api/feature-requests/${request.id}/brief`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onSaved(mapRow(json.row), { close: false });
      toast("Brief updated");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBriefing(false);
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
        onClick={() => !busy && onClose()}
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
          width: 680,
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
            {isCreate ? "New request" : editing ? "Edit request" : "Request"}
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
          {editing ? (
            <>
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
            </>
          ) : (
            request && (
              <TicketView
                request={request}
                status={status}
                onStatus={changeStatus}
                statusDisabled={busy}
                briefing={briefing}
                onRegenerate={regenerate}
              />
            )
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
                disabled={busy}
              >
                Delete
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => (isCreate ? onClose() : setEditing(false))}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button variant="primary" onClick={save} disabled={busy}>
                  {saving ? "Saving…" : isCreate ? "Create" : "Save"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  icon={<Icons.Sparkles />}
                  onClick={regenerate}
                  disabled={busy}
                >
                  {briefing
                    ? "Writing brief…"
                    : request?.details?.brief
                      ? "Regenerate brief"
                      : "Generate brief"}
                </Button>
                <Button
                  variant="primary"
                  icon={<Icons.Edit />}
                  onClick={() => setEditing(true)}
                  disabled={busy}
                >
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Read view

function TicketView({
  request,
  status,
  onStatus,
  statusDisabled,
  briefing,
  onRegenerate,
}: {
  request: FeatureRequest;
  status: FeatureRequestStatus;
  onStatus: (s: FeatureRequestStatus) => void;
  statusDisabled: boolean;
  briefing: boolean;
  onRegenerate: () => void;
}) {
  const d: FeatureRequestDetails | null = request.details;
  const brief = d?.brief ?? null;
  // Older rows keep their links inside the description; strip those lines
  // from the quote fallback so it reads as the user's words.
  const fallbackQuote = request.description
    .split("\n")
    .filter((l) => !/^(Support thread|Trello):\s/.test(l.trim()))
    .join("\n")
    .trim();
  const quote = d?.quote ?? (fallbackQuote || null);
  const threadUrl = d?.threadUrl ?? matchUrl(request.description, /https?:\/\/\S+[?&]thread=[0-9a-f-]{36}/i);
  const trelloUrl = d?.trelloUrl ?? matchUrl(request.description, /https:\/\/trello\.com\/c\/[A-Za-z0-9]+/);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          className="serif"
          style={{ fontSize: 24, lineHeight: 1.25, fontWeight: 400 }}
        >
          {request.title}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <select
            value={status}
            onChange={(e) => onStatus(e.target.value as FeatureRequestStatus)}
            disabled={statusDisabled}
            aria-label="Status"
            style={{
              ...inputStyle,
              width: "auto",
              padding: "5px 10px",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {brief && (
            <Chip tone={brief.kind === "bug" ? "accent" : "ink"}>
              {KIND_LABELS[brief.kind] ?? brief.kind}
            </Chip>
          )}
          {(request.epic || brief?.area) && (
            <Chip tone="neutral">{request.epic ?? brief?.area}</Chip>
          )}
          {brief && <Chip tone="neutral">{brief.effort} effort</Chip>}
          <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 4 }}>
            Filed {formatDate(request.createdAt)}
            {d?.receivedAt ? ` · asked ${formatDate(d.receivedAt)}` : ""}
          </span>
        </div>
      </div>

      {brief ? (
        <Section label="What they want">
          <div style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 500 }}>
            {brief.ask}
          </div>
          {brief.why && (
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)", marginTop: 6 }}>
              {brief.why}
            </div>
          )}
        </Section>
      ) : (
        <div
          style={{
            padding: "14px 16px",
            border: "1px dashed var(--line)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--ink-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>
            {briefing
              ? "Writing the brief…"
              : "No brief yet. Generate one to see what this needs at a glance."}
          </span>
          {!briefing && (
            <Button size="sm" variant="secondary" icon={<Icons.Sparkles />} onClick={onRegenerate}>
              Generate
            </Button>
          )}
        </div>
      )}

      {brief && brief.needs.length > 0 && (
        <Section label={brief.kind === "bug" ? "What to fix" : "What it needs"}>
          <Bullets items={brief.needs} />
        </Section>
      )}

      {brief && brief.openQuestions.length > 0 && (
        <Section label="Open questions">
          <Bullets items={brief.openQuestions} />
        </Section>
      )}

      {quote && (
        <Section label="In their words">
          <blockquote
            style={{
              margin: 0,
              padding: "10px 14px",
              borderLeft: "3px solid var(--line)",
              background: "var(--surface-2)",
              borderRadius: "0 8px 8px 0",
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
            }}
          >
            {quote}
          </blockquote>
        </Section>
      )}

      {d && d.screenshots.length > 0 && (
        <Section label={`Screenshots (${d.screenshots.length})`}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {d.screenshots.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u}
                  alt="User screenshot"
                  style={{
                    width: 96,
                    height: 160,
                    objectFit: "cover",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                  }}
                />
              </a>
            ))}
          </div>
        </Section>
      )}

      <Section label="Requested by">
        <RequesterCard details={d} fallbackEmail={request.submitterEmail} />
      </Section>

      {(threadUrl || trelloUrl) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {threadUrl && (
            <LinkButton href={threadUrl} newTab={false}>
              Open support thread
            </LinkButton>
          )}
          {trelloUrl && <LinkButton href={trelloUrl}>Open in Trello</LinkButton>}
        </div>
      )}
    </>
  );
}

function RequesterCard({
  details,
  fallbackEmail,
}: {
  details: FeatureRequestDetails | null;
  fallbackEmail: string | null;
}) {
  const r = details?.requester;
  const email = r?.email ?? fallbackEmail;
  if (!r && !email) {
    return <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Unknown</div>;
  }
  const rows: Array<[string, string]> = [];
  if (r?.plan) rows.push(["Plan", r.store ? `${r.plan} · ${r.store}` : r.plan]);
  if (r?.totalPaidUsd != null) rows.push(["Paid", `$${r.totalPaidUsd.toFixed(2)}`]);
  if (r?.memberSince) rows.push(["Member since", formatDate(r.memberSince)]);
  if (r?.journeyStage) rows.push(["GLP-1 stage", r.journeyStage.replace(/_/g, " ")]);
  if (details?.source && details.source !== "manual") {
    rows.push(["Came in via", details.source === "feedback" ? "In-app feedback" : "Email"]);
  }
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13 }}>
        {r?.name && <span style={{ fontWeight: 600 }}>{r.name}</span>}
        {r?.name && email && <span style={{ color: "var(--ink-3)" }}> · </span>}
        {email && <span style={{ color: "var(--ink-2)" }}>{email}</span>}
      </div>
      {rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "120px 1fr",
            rowGap: 4,
            fontSize: 12,
          }}
        >
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <span style={{ color: "var(--ink-3)" }}>{k}</span>
              <span style={{ color: "var(--ink)" }}>{v}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((t, i) => (
        <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>
          {t}
        </li>
      ))}
    </ul>
  );
}

function LinkButton({
  href,
  children,
  newTab = true,
}: {
  href: string;
  children: React.ReactNode;
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        fontSize: 12,
        fontWeight: 500,
        border: "1px solid var(--line)",
        borderRadius: 8,
        color: "var(--ink)",
        textDecoration: "none",
        background: "var(--surface)",
      }}
    >
      <Icons.Link size={14} />
      {children}
    </a>
  );
}

function matchUrl(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[0] : null;
}

function mapRow(row: {
  id: string;
  title: string;
  description: string;
  status: FeatureRequestStatus;
  epic: string | null;
  submitter_email: string | null;
  details?: FeatureRequestDetails | null;
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
    details: row.details ?? null,
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

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--font-geist-mono), monospace",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--ink-3)",
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
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}
