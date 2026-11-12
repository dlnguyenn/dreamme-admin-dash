"use client";

/**
 * Experiments tab: every test we run (with a control group) and every change
 * we ship to everyone (without one), newest first. Filter by kind, status and
 * area; click a row to read the full entry, then Edit to change it.
 *
 * The two kinds look different on purpose: an experiment's result is a real
 * comparison, a change's result is only a before/after read.
 *
 * Rules and labels: src/lib/experiment-log.ts. Storage: /api/experiments.
 * Arm-level readouts for the April-plan tests stay on April Plan > Experiments.
 */
import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { Card, ErrorBanner, FilterPill, Segmented, StatStrip, StatusPill } from "./porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  AREA_LABELS,
  EXPERIMENT_AREAS,
  EXPERIMENT_OWNERS,
  EXPERIMENT_STATUSES,
  KIND_HINTS,
  KIND_LABELS,
  dateRangeError,
  dateRangeLabel,
  daysRunning,
  rcExperimentUrl,
  sortEntries,
  statusLabel,
  type ExperimentArea,
  type ExperimentEntry,
  type ExperimentKind,
  type ExperimentStatus,
  type RcExperimentState,
} from "@/lib/experiment-log";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

type KindFilter = "all" | ExperimentKind;
type StatusFilter = "all" | "active" | ExperimentStatus;

/** Experiments wear a solid blue rail; changes a dashed neutral one. */
const KIND_COLOR: Record<ExperimentKind, string> = {
  experiment: "var(--cat-3)",
  change: "var(--ink-4)",
};

function statusPillKind(s: ExperimentStatus): "running" | "attention" | "neutral" | "success" | "danger" {
  if (s === "running") return "running";
  if (s === "decided") return "success";
  return "neutral";
}

export function KindTag({ kind }: { kind: ExperimentKind }) {
  const exp = kind === "experiment";
  return (
    <span
      title={KIND_HINTS[kind]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        font: "650 10.5px var(--font-ui)",
        padding: "3px 8px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        // Filled for a controlled test, dashed outline for an uncontrolled change.
        background: exp ? `color-mix(in srgb, ${KIND_COLOR.experiment} 14%, var(--surface))` : "transparent",
        color: exp ? KIND_COLOR.experiment : "var(--ink-3)",
        border: exp
          ? `1px solid color-mix(in srgb, ${KIND_COLOR.experiment} 35%, var(--line))`
          : "1px dashed var(--line-2)",
      }}
    >
      {exp ? <Icons.Flask size={11} /> : <Icons.Swap size={11} />}
      {exp ? "Experiment" : "Change · no control"}
    </span>
  );
}

export function ExperimentLog() {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [entries, setEntries] = React.useState<ExperimentEntry[] | null>(null);
  const [rc, setRc] = React.useState<Record<string, RcExperimentState>>({});
  const [rcError, setRcError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<KindFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [area, setArea] = React.useState<"all" | ExperimentArea>("all");
  // undefined = closed, null = new entry, entry = open that one
  const [open, setOpen] = React.useState<ExperimentEntry | null | undefined>(undefined);

  const load = React.useCallback(async () => {
    try {
      const body = await api<{
        entries: ExperimentEntry[];
        rc: Record<string, RcExperimentState>;
        rcError: string | null;
      }>("/api/experiments", { cache: "no-store" });
      setEntries(body.entries);
      setRc(body.rc ?? {});
      setRcError(body.rcError ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // ?entry=<id> opens that entry once the list has loaded.
  React.useEffect(() => {
    if (!entries) return;
    const id = new URLSearchParams(window.location.search).get("entry");
    if (!id) return;
    const hit = entries.find((e) => e.id === id);
    if (hit) setOpen(hit);
  }, [entries]);

  const all = React.useMemo(() => sortEntries(entries ?? []), [entries]);
  const byKind = all.filter((e) => kind === "all" || e.kind === kind);
  const byArea = byKind.filter((e) => area === "all" || e.area === area);
  const matchesStatus = (e: ExperimentEntry, s: StatusFilter) =>
    s === "all" ? true : s === "active" ? e.status === "running" : e.status === s;
  const shown = byArea.filter((e) => matchesStatus(e, status));

  const count = (pred: (e: ExperimentEntry) => boolean) => all.filter(pred).length;
  const areasInUse = EXPERIMENT_AREAS.filter((a) => all.some((e) => e.area === a));

  return (
    <div>
      <PageHeader
        eyebrow="Product"
        title="Experiments"
        subtitle="Every test we run and every change we ship to everyone, with what we expected, what happened and what we decided."
        actions={
          <Button variant="primary" icon={<Icons.Plus />} onClick={() => setOpen(null)}>
            New entry
          </Button>
        }
      />

      {error && <ErrorBanner>Couldn&apos;t load experiments: {error}</ErrorBanner>}

      <StatStrip
        minColWidth={isMobile ? 140 : 170}
        stats={[
          {
            label: "On now",
            value: String(count((e) => e.status === "running")),
            note: "tests + live changes",
          },
          {
            label: "Up next",
            value: String(count((e) => e.status === "planned" || e.status === "draft")),
            note: "planned or drafted",
          },
          {
            label: "With a control",
            value: String(count((e) => e.kind === "experiment")),
            note: "real comparisons",
          },
          {
            label: "No control",
            value: String(count((e) => e.kind === "change")),
            note: "before/after reads only",
          },
        ]}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          margin: "22px 0 14px",
        }}
      >
        <Segmented
          size="sm"
          value={kind}
          onChange={(v) => setKind(v as KindFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "experiment", label: "Experiments" },
            { value: "change", label: "Changes" },
          ]}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(["all", ...EXPERIMENT_STATUSES] as StatusFilter[]).map((s) => {
            const n = s === "all" ? byArea.length : byArea.filter((e) => matchesStatus(e, s)).length;
            if (s !== "all" && n === 0 && status !== s) return null;
            const label =
              s === "all"
                ? "Any status"
                : kind === "change"
                  ? statusLabel("change", s as ExperimentStatus)
                  : statusLabel("experiment", s as ExperimentStatus);
            return (
              <FilterPill
                key={s}
                label={label}
                count={n}
                selected={status === s}
                onClick={() => setStatus(s)}
              />
            );
          })}
        </div>
        <select
          aria-label="Area"
          value={area}
          onChange={(e) => setArea(e.target.value as "all" | ExperimentArea)}
          style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13, borderRadius: 999 }}
        >
          <option value="all">All areas</option>
          {areasInUse.map((a) => (
            <option key={a} value={a}>
              {AREA_LABELS[a]}
            </option>
          ))}
        </select>
      </div>

      {rcError && all.some((e) => e.rc_experiment_id) && (
        <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)", margin: "0 0 10px" }}>
          Live RevenueCat status unavailable: {rcError}. Entries link to RevenueCat instead.
        </div>
      )}

      <Card pad={0} style={{ overflow: "hidden" }}>
        {entries == null && !error ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{all.length === 0 ? "Nothing logged yet. Add the first entry." : "Nothing matches these filters."}</Empty>
        ) : (
          shown.map((e, i) => (
            <Row key={e.id} entry={e} rc={e.rc_experiment_id ? rc[e.rc_experiment_id] : undefined} first={i === 0} onOpen={() => setOpen(e)} />
          ))
        )}
      </Card>

      <div style={{ font: "400 12px/1.55 var(--font-ui)", color: "var(--ink-4)", margin: "12px 2px 40px" }}>
        Arm-by-arm numbers for the April-plan tests are on{" "}
        <a href="/?tab=plan" style={{ color: "var(--ink-2)" }}>
          April Plan › Experiments
        </a>
        . Claude sessions can add entries with <code>POST /api/experiments</code>.
      </div>

      {open !== undefined && (
        <EntryDrawer
          entry={open}
          rc={open?.rc_experiment_id ? rc[open.rc_experiment_id] : undefined}
          rcError={rcError}
          onClose={() => setOpen(undefined)}
          onSaved={(saved) => {
            setEntries((prev) => sortEntries([...(prev ?? []).filter((x) => x.id !== saved.id), saved]));
            setOpen(saved);
          }}
          onDeleted={(id) => {
            setEntries((prev) => (prev ?? []).filter((x) => x.id !== id));
            setOpen(undefined);
            toast("Deleted");
          }}
        />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "34px 20px", textAlign: "center", font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
      {children}
    </div>
  );
}

function Row({
  entry,
  rc,
  first,
  onOpen,
}: {
  entry: ExperimentEntry;
  rc?: RcExperimentState;
  first: boolean;
  onOpen: () => void;
}) {
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState(false);
  const days = daysRunning(entry.start_date, entry.end_date, todayIso());
  const summary = entry.result || entry.hypothesis || entry.what_changed;
  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderTop: first ? "none" : "1px solid var(--line)",
        background: hover ? "var(--surface-2)" : "transparent",
        padding: 0,
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      }}
    >
      {/* Kind rail: solid for an experiment, dashed for a change. */}
      <span
        aria-hidden
        style={{
          width: 0,
          flex: "none",
          margin: "10px 0 10px 10px",
          borderLeft:
            entry.kind === "experiment" ? `3px solid ${KIND_COLOR.experiment}` : `3px dashed ${KIND_COLOR.change}`,
          borderRadius: 2,
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: isMobile ? "12px 14px" : "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <KindTag kind={entry.kind} />
          <span style={{ font: "500 11.5px var(--font-ui)", color: "var(--ink-3)" }}>{AREA_LABELS[entry.area]}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {rc && rc.status !== entry.status && (
              <span title="Status in RevenueCat" style={{ font: "500 11px var(--font-ui)", color: "var(--ink-4)" }}>
                RC: {rc.status}
              </span>
            )}
            <StatusPill kind={statusPillKind(entry.status)}>{statusLabel(entry.kind, entry.status)}</StatusPill>
          </span>
        </span>
        <span style={{ font: "650 15px/1.35 var(--font-ui)", color: "var(--ink)" }}>{entry.title}</span>
        <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {dateRangeLabel(entry.start_date, entry.end_date)}
          {days != null && ` · ${days} day${days === 1 ? "" : "s"}`}
          {entry.owner && ` · ${entry.owner}`}
        </span>
        {summary && (
          <span
            style={{
              font: "400 13px/1.5 var(--font-ui)",
              color: "var(--ink-2)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {entry.result ? <strong style={{ fontWeight: 650, color: "var(--ink)" }}>Result: </strong> : null}
            {summary}
          </span>
        )}
      </span>
    </button>
  );
}

// ---- Drawer ----------------------------------------------------------------

type Draft = Omit<ExperimentEntry, "id" | "created_at" | "updated_at">;

const BLANK: Draft = {
  title: "",
  kind: "experiment",
  area: "other",
  status: "planned",
  hypothesis: "",
  what_changed: "",
  has_control: true,
  start_date: null,
  end_date: null,
  primary_metric: "",
  result: "",
  decision: "",
  rc_experiment_id: null,
  vault_page: null,
  links: "",
  handoff_id: null,
  owner: null,
};

function toDraft(e: ExperimentEntry | null): Draft {
  if (!e) return { ...BLANK };
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = e;
  void _id;
  void _c;
  void _u;
  return rest;
}

function EntryDrawer({
  entry,
  rc,
  rcError,
  onClose,
  onSaved,
  onDeleted,
}: {
  entry: ExperimentEntry | null;
  rc?: RcExperimentState;
  rcError: string | null;
  onClose: () => void;
  onSaved: (e: ExperimentEntry) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const isCreate = entry === null;
  const [editing, setEditing] = React.useState(isCreate);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(entry));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(toDraft(entry));
    setEditing(entry === null);
    setError(null);
  }, [entry]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!draft.title.trim()) return setError("Title required");
    const rangeError = dateRangeError(draft.start_date, draft.end_date);
    if (rangeError) return setError(rangeError);
    setSaving(true);
    setError(null);
    const body = {
      ...draft,
      title: draft.title.trim(),
      has_control: draft.kind === "change" ? false : draft.has_control,
    };
    try {
      const { entry: saved } = await api<{ entry: ExperimentEntry }>(
        isCreate ? "/api/experiments" : `/api/experiments/${entry!.id}`,
        { method: isCreate ? "POST" : "PATCH", body: JSON.stringify(body) },
      );
      onSaved(saved);
      setEditing(false);
      toast(isCreate ? "Logged" : "Saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!entry) return;
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    setSaving(true);
    try {
      await api(`/api/experiments/${entry.id}`, { method: "DELETE" });
      onDeleted(entry.id);
    } catch (e) {
      setError((e as Error).message);
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
        role="dialog"
        aria-label={isCreate ? "New entry" : entry?.title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 620,
          maxWidth: "100vw",
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
            padding: "16px 22px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div className="serif" style={{ fontSize: 20 }}>
            {isCreate ? "New entry" : editing ? "Edit entry" : KIND_LABELS[entry!.kind]}
          </div>
          <button onClick={onClose} aria-label="Close" style={iconButton}>
            <Icons.Close size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {editing ? (
            <EditForm draft={draft} set={set} />
          ) : (
            entry && <ReadView entry={entry} rc={rc} rcError={rcError} />
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
            {!isCreate && editing && (
              <Button variant="danger" icon={<Icons.Trash />} onClick={del} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (isCreate) return onClose();
                    setDraft(toDraft(entry));
                    setEditing(false);
                    setError(null);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button variant="primary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : isCreate ? "Add" : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="primary" icon={<Icons.Edit />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function ReadView({
  entry,
  rc,
  rcError,
}: {
  entry: ExperimentEntry;
  rc?: RcExperimentState;
  rcError: string | null;
}) {
  const days = daysRunning(entry.start_date, entry.end_date, todayIso());
  const links = entry.links
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <KindTag kind={entry.kind} />
          <StatusPill kind={statusPillKind(entry.status)}>{statusLabel(entry.kind, entry.status)}</StatusPill>
          <span style={{ font: "500 12px var(--font-ui)", color: "var(--ink-3)" }}>{AREA_LABELS[entry.area]}</span>
        </div>
        <h2 style={{ font: "650 20px/1.3 var(--font-ui)", margin: 0, color: "var(--ink)" }}>{entry.title}</h2>
        <div style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>
          {dateRangeLabel(entry.start_date, entry.end_date)}
          {days != null && ` · ${days} day${days === 1 ? "" : "s"}`}
          {entry.owner && ` · owner ${entry.owner}`}
        </div>
        {entry.kind === "change" && (
          <div
            style={{
              font: "400 12.5px/1.5 var(--font-ui)",
              color: "var(--ink-2)",
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px dashed var(--line-2)",
            }}
          >
            Shipped to everyone with no control group, so any result here is a before/after read and can be
            mixed up with seasonality, ad changes or anything else that moved at the same time.
          </div>
        )}
      </div>

      <Section label="Hypothesis" text={entry.hypothesis} />
      <Section label="What changed, for whom" text={entry.what_changed} />
      <Section label="Primary metric" text={entry.primary_metric} />
      <Section label="Result" text={entry.result} emptyText="Not read yet." strong />
      <Section label="Decision" text={entry.decision} emptyText="No decision yet." />

      {(entry.rc_experiment_id || entry.vault_page || entry.handoff_id || links.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>Links</span>
          {entry.rc_experiment_id && (
            <div style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)" }}>
              RevenueCat experiment <code>{entry.rc_experiment_id}</code>
              {rc ? (
                <>
                  {" "}
                  · <strong style={{ color: "var(--ink)" }}>{rc.status}</strong>
                  {rc.started_at && ` since ${rc.started_at.slice(0, 10)}`}
                  {rc.stopped_at && `, stopped ${rc.stopped_at.slice(0, 10)}`}
                  {rc.enrollment_percentage != null && ` · ${rc.enrollment_percentage}% enrolled`}
                </>
              ) : rcError ? (
                <span style={{ color: "var(--ink-4)" }}> · live status unavailable</span>
              ) : null}
              {" · "}
              <a href={rcExperimentUrl(entry.rc_experiment_id)} target="_blank" rel="noreferrer" style={linkStyle}>
                Open in RevenueCat ↗
              </a>
            </div>
          )}
          {entry.vault_page && (
            <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)" }}>
              Vault: <code>{entry.vault_page}</code>
            </div>
          )}
          {entry.handoff_id && (
            <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)" }}>
              Handoff: <code>{entry.handoff_id}</code>
            </div>
          )}
          {links.map((l) =>
            /^https?:\/\//.test(l) ? (
              <a key={l} href={l} target="_blank" rel="noreferrer" style={{ ...linkStyle, overflowWrap: "anywhere" }}>
                {l} ↗
              </a>
            ) : (
              <div key={l} style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)", overflowWrap: "anywhere" }}>
                {l}
              </div>
            ),
          )}
        </div>
      )}

      <div style={{ font: "400 11px var(--font-ui)", color: "var(--ink-4)" }}>
        Logged {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        {entry.updated_at !== entry.created_at &&
          ` · updated ${new Date(entry.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
      </div>
    </div>
  );
}

function Section({
  label,
  text,
  emptyText,
  strong,
}: {
  label: string;
  text: string;
  emptyText?: string;
  strong?: boolean;
}) {
  if (!text && !emptyText) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <div
        style={{
          font: `${strong && text ? 500 : 400} 13.5px/1.6 var(--font-ui)`,
          color: text ? "var(--ink)" : "var(--ink-4)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {text || emptyText}
      </div>
    </div>
  );
}

function EditForm({ draft, set }: { draft: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  const isMobile = useIsMobile();
  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
    gap: 12,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Field label="Title">
        <input
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Monthly $19.99 vs $14.99 (iOS, US)"
          style={inputStyle}
          autoFocus
        />
      </Field>

      <div style={grid}>
        <Field label="Kind">
          <select
            value={draft.kind}
            onChange={(e) => {
              const k = e.target.value as ExperimentKind;
              set("kind", k);
              set("has_control", k === "experiment");
            }}
            style={inputStyle}
          >
            <option value="experiment">Experiment (has a control)</option>
            <option value="change">Change (shipped to everyone)</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={draft.status} onChange={(e) => set("status", e.target.value as ExperimentStatus)} style={inputStyle}>
            {EXPERIMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(draft.kind, s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Area">
          <select value={draft.area} onChange={(e) => set("area", e.target.value as ExperimentArea)} style={inputStyle}>
            {EXPERIMENT_AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner">
          <select value={draft.owner ?? ""} onChange={(e) => set("owner", e.target.value || null)} style={inputStyle}>
            <option value="">Unassigned</option>
            {EXPERIMENT_OWNERS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start date">
          <input type="date" value={draft.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} style={inputStyle} />
        </Field>
        <Field label="End date">
          <input type="date" value={draft.end_date ?? ""} onChange={(e) => set("end_date", e.target.value || null)} style={inputStyle} />
        </Field>
      </div>

      {draft.kind === "experiment" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, font: "400 13px var(--font-ui)", color: "var(--ink-2)" }}>
          <input type="checkbox" checked={draft.has_control} onChange={(e) => set("has_control", e.target.checked)} />
          Has a control group (untick for a test that ended up with no clean control)
        </label>
      )}

      <Field label="Hypothesis">
        <textarea
          value={draft.hypothesis}
          onChange={(e) => set("hypothesis", e.target.value)}
          placeholder="If we do X, Y will go up, because…"
          style={{ ...inputStyle, minHeight: 70, resize: "vertical", lineHeight: 1.5 }}
        />
      </Field>
      <Field label="What changed, for whom">
        <textarea
          value={draft.what_changed}
          onChange={(e) => set("what_changed", e.target.value)}
          placeholder="Platform, country, new or existing users, % of traffic"
          style={{ ...inputStyle, minHeight: 70, resize: "vertical", lineHeight: 1.5 }}
        />
      </Field>
      <Field label="Primary metric">
        <input
          value={draft.primary_metric}
          onChange={(e) => set("primary_metric", e.target.value)}
          placeholder="e.g. realized LTV per new customer"
          style={inputStyle}
        />
      </Field>
      <Field label="Result">
        <textarea
          value={draft.result}
          onChange={(e) => set("result", e.target.value)}
          placeholder="What happened, in plain words, with numbers"
          style={{ ...inputStyle, minHeight: 90, resize: "vertical", lineHeight: 1.5 }}
        />
      </Field>
      <Field label="Decision">
        <textarea
          value={draft.decision}
          onChange={(e) => set("decision", e.target.value)}
          placeholder="What we decided and why"
          style={{ ...inputStyle, minHeight: 70, resize: "vertical", lineHeight: 1.5 }}
        />
      </Field>

      <div style={grid}>
        <Field label="RevenueCat experiment id">
          <input
            value={draft.rc_experiment_id ?? ""}
            onChange={(e) => set("rc_experiment_id", e.target.value || null)}
            placeholder="exp…"
            style={inputStyle}
          />
        </Field>
        <Field label="Vault page">
          <input
            value={draft.vault_page ?? ""}
            onChange={(e) => set("vault_page", e.target.value || null)}
            placeholder="wiki/pricing.md#first-price-test"
            style={inputStyle}
          />
        </Field>
        <Field label="Handoff id">
          <input value={draft.handoff_id ?? ""} onChange={(e) => set("handoff_id", e.target.value || null)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Other links (one per line)">
        <textarea
          value={draft.links}
          onChange={(e) => set("links", e.target.value)}
          placeholder="PRs, commits, dashboards…"
          style={{ ...inputStyle, minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
        />
      </Field>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "9px 12px",
        fontSize: 12,
        color: "var(--danger-text)",
        background: "var(--danger-soft)",
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
  color: "var(--ink-2)",
};

const linkStyle: React.CSSProperties = { color: "var(--accent-text)", font: "500 13px var(--font-ui)" };
