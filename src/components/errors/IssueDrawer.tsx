"use client";

/**
 * One issue: status actions, counts, 30 days by version, and a stored sample
 * with its stack trace (resolved through a source map when one is uploaded),
 * breadcrumbs and device context. Loads /api/errors/issue/:id.
 */
import * as React from "react";
import { SideDrawer } from "../SideDrawer";
import { Button, useCopy, useToast } from "../ui";
import { Icons } from "../Icons";
import { ErrorBanner, InfoWell, Segmented } from "../porcelain";
import { controlStyle } from "../competitor-ads/parts";
import type { DailyRow, EventRow, IssueRow } from "@/lib/errors/store";
import type { ExceptionValue, Frame } from "@/lib/errors/event";
import { isBundleFrame } from "@/lib/errors/frames";
import { ago, Bars, Flag, n, PLATFORM_LABEL, shortRelease, when } from "./shared";

interface Detail {
  issue: IssueRow;
  daily: DailyRow[];
  samples: Omit<EventRow, "payload" | "symbolicated">[];
  event: EventRow | null;
  symbolicated: { exceptions: (ExceptionValue & { frames: (Frame & { resolved?: boolean })[] })[]; resolvedFrames: number; missing: string[] } | null;
  symbolicateError: string | null;
}

interface Breadcrumb {
  timestamp: number | string | null;
  type: string | null;
  category: string | null;
  level: string | null;
  message: string | null;
  data: Record<string, unknown> | null;
}

const section = (title: string) => (
  <h3 style={{ font: "650 13px var(--font-ui)", color: "var(--ink)", margin: "26px 0 10px" }}>{title}</h3>
);

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{label}</div>
      <div style={{ font: "600 15px var(--font-ui)", color: "var(--ink)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function frameText(f: Frame) {
  const where = f.filename ?? f.abs_path ?? f.package?.split("/").pop() ?? f.module ?? "";
  const pos = f.lineno != null ? `:${f.lineno}${f.colno != null ? `:${f.colno}` : ""}` : "";
  return { fn: f.function ?? f.symbol ?? f.instruction_addr ?? "?", where: `${where}${pos}` };
}

function StackTrace({ ex, showLibrary }: { ex: ExceptionValue & { frames: (Frame & { resolved?: boolean })[] }; showLibrary: boolean }) {
  // Sentry lists frames oldest first; read them crash-site first.
  const frames = [...ex.frames].reverse();
  const anyInApp = frames.some((f) => f.in_app);
  const visible = showLibrary || !anyInApp ? frames : frames.filter((f) => f.in_app);
  const hidden = frames.length - visible.length;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ font: "650 14px/1.4 var(--font-ui)", color: "var(--ink)", overflowWrap: "anywhere" }}>
        {ex.type ?? "Error"}
        {ex.mechanism?.type ? <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}> · {ex.mechanism.type}{ex.mechanism.handled === false ? ", not handled" : ""}</span> : null}
      </div>
      {ex.value && <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--ink-2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 3 }}>{ex.value}</div>}
      {frames.length > 0 && (
        <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0, background: "var(--surface-2)", borderRadius: 12, overflow: "hidden" }}>
          {visible.map((f, i) => {
            const t = frameText(f);
            return (
              <li key={i} style={{ padding: "8px 12px", borderTop: i ? "1px solid var(--line)" : undefined }}>
                <div style={{ font: `${f.in_app ? 600 : 400} 12.5px/1.45 var(--font-mono)`, color: f.in_app ? "var(--ink)" : "var(--ink-3)", overflowWrap: "anywhere" }}>
                  {t.fn}
                </div>
                <div style={{ font: "400 12px/1.45 var(--font-mono)", color: "var(--ink-3)", overflowWrap: "anywhere" }}>{t.where}</div>
                {f.context_line && (
                  <div style={{ font: "400 12px/1.45 var(--font-mono)", color: "var(--ink-2)", marginTop: 3, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{f.context_line}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {hidden > 0 && <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 6 }}>{hidden} library frames hidden</div>}
    </div>
  );
}

function crumbTime(t: Breadcrumb["timestamp"], base: string) {
  if (t == null) return "";
  const ms = typeof t === "number" ? t * 1000 : Date.parse(t);
  const d = (ms - Date.parse(base)) / 1000;
  if (!Number.isFinite(d)) return "";
  return d > -1 ? "at error" : d > -60 ? `${Math.round(d)}s` : `${Math.round(d / 60)}m`;
}

function summaryText(d: Detail) {
  const ex = (d.symbolicated?.exceptions ?? (d.event?.payload.exceptions as ExceptionValue[] | undefined) ?? []).at(-1);
  const frames = ex ? [...ex.frames].reverse().filter((f) => f.in_app).slice(0, 8).map((f) => `  at ${frameText(f).fn} (${frameText(f).where})`) : [];
  return [
    `DAD Errors issue #${d.issue.id}: ${d.issue.title}`,
    d.issue.culprit ? `Culprit: ${d.issue.culprit}` : null,
    `${n(d.issue.event_count)} events, ${n(d.issue.user_count)} users; first ${d.issue.first_seen.slice(0, 10)} (${shortRelease(d.issue.first_release)}), last ${d.issue.last_seen.slice(0, 10)} (${shortRelease(d.issue.last_release)})`,
    d.event ? `Sample: ${d.event.os ?? ""} ${d.event.device ?? ""}, ${shortRelease(d.event.release)}` : null,
    ...frames,
  ]
    .filter(Boolean)
    .join("\n");
}

export function IssueDrawer({ issueId, onClose, onChanged }: { issueId: number | null; onClose: () => void; onChanged: (i: IssueRow) => void }) {
  const [d, setD] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [eventId, setEventId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"source" | "raw">("source");
  const [showLibrary, setShowLibrary] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const { copy } = useCopy();

  React.useEffect(() => {
    setD(null);
    setEventId(null);
    setError(null);
    setShowLibrary(false);
  }, [issueId]);

  React.useEffect(() => {
    if (issueId == null) return;
    let cancelled = false;
    fetch(`/api/errors/issue/${issueId}${eventId ? `?event=${eventId}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        if (!b.ok) throw new Error(b.error ?? "Could not load");
        setD(b);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [issueId, eventId]);

  const setStatus = async (status: IssueRow["status"]) => {
    if (!d) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/errors/issue/${d.issue.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const b = await res.json();
      if (!b.ok) throw new Error(b.error ?? "Could not update");
      setD({ ...d, issue: b.issue });
      onChanged(b.issue);
      toast(status === "resolved" ? "Resolved. It reopens if it happens again." : status === "ignored" ? "Ignored. It stays out of the lists and alerts." : "Reopened");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const issue = d?.issue;
  const days = React.useMemo(() => {
    if (!d) return { series: [] as number[], releases: [] as { release: string; events: number }[] };
    const now = Date.now();
    const keys = Array.from({ length: 30 }, (_, k) => new Date(now - (29 - k) * 86_400_000).toISOString().slice(0, 10));
    const byDay = new Map<string, number>();
    const byRel = new Map<string, number>();
    for (const r of d.daily) {
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.events);
      byRel.set(r.release, (byRel.get(r.release) ?? 0) + r.events);
    }
    return {
      series: keys.map((k) => byDay.get(k) ?? 0),
      releases: Array.from(byRel, ([release, events]) => ({ release, events })).sort((a, b) => b.events - a.events),
    };
  }, [d]);

  const payload = d?.event?.payload as
    | { exceptions?: ExceptionValue[]; breadcrumbs?: Breadcrumb[]; contexts?: Record<string, Record<string, unknown> | null>; timestamp?: unknown }
    | undefined;
  const rawEx = (payload?.exceptions ?? []) as (ExceptionValue & { frames: Frame[] })[];
  const exceptions = view === "source" && d?.symbolicated ? d.symbolicated.exceptions : rawEx;
  const images = ((d?.event?.payload as { debug_images?: Record<string, unknown>[] } | undefined)?.debug_images ?? []) as Record<string, unknown>[];
  const hasBundleFrames = rawEx.some((e) => e.frames.some((f) => isBundleFrame(f, images)));
  const ctx = payload?.contexts ?? {};
  const app = (ctx.app ?? {}) as Record<string, unknown>;
  const ota = (ctx.ota_updates ?? {}) as Record<string, unknown>;

  return (
    <SideDrawer open={issueId != null} onClose={onClose} desktopWidth={760} ariaLabel="Error issue">
      <div style={{ padding: "22px 26px 40px", overflowY: "auto", height: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <Button size="sm" variant="ghost" icon={<Icons.Close />} onClick={onClose}>
            Close
          </Button>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!d && !error && <InfoWell>Loading…</InfoWell>}
        {d && issue && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>{PLATFORM_LABEL[issue.platform ?? ""] ?? issue.platform}</span>
              {issue.handled === false && <Flag kind="danger">Not handled</Flag>}
              {issue.status !== "unresolved" && <Flag kind="neutral">{issue.status === "resolved" ? "Resolved" : "Ignored"}</Flag>}
              {issue.regressed_at && issue.status === "unresolved" && <Flag kind="warning">Came back {ago(issue.regressed_at)}</Flag>}
            </div>
            <h2 style={{ font: "650 20px/1.3 var(--font-display)", color: "var(--ink)", margin: 0, overflowWrap: "anywhere" }}>{issue.title}</h2>
            {issue.culprit && <div style={{ font: "400 13px var(--font-mono)", color: "var(--ink-3)", marginTop: 6, overflowWrap: "anywhere" }}>{issue.culprit}</div>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {issue.status === "unresolved" ? (
                <>
                  <Button size="sm" variant="primary" icon={<Icons.Check />} disabled={busy} onClick={() => void setStatus("resolved")}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus("ignored")}>
                    Ignore
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus("unresolved")}>
                  Reopen
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Icons.Copy />} onClick={() => copy(summaryText(d))}>
                Copy for a ticket
              </Button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16, marginTop: 22 }}>
              <Fact label="Events" value={n(issue.event_count)} />
              <Fact label="Users" value={n(issue.user_count)} />
              <Fact label="First seen" value={ago(issue.first_seen)} sub={shortRelease(issue.first_release)} />
              <Fact label="Last seen" value={ago(issue.last_seen)} sub={shortRelease(issue.last_release)} />
            </div>

            {section("Last 30 days")}
            <Bars values={days.series} width={700} height={56} fluid />
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, font: "400 12.5px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
              {days.releases.slice(0, 6).map((r) => (
                <span key={r.release}>
                  {shortRelease(r.release || null)}: {n(r.events)}
                </span>
              ))}
            </div>

            {d.event ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "26px 0 10px" }}>
                  <h3 style={{ font: "650 13px var(--font-ui)", color: "var(--ink)", margin: 0 }}>Stack trace</h3>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
                    {d.samples.length > 1 && (
                      <select
                        aria-label="Sample event"
                        value={d.event.event_id}
                        onChange={(e) => setEventId(e.target.value)}
                        className="err-focus"
                        style={{ ...controlStyle, cursor: "pointer", minWidth: 0, maxWidth: "100%", flex: "1 1 auto" }}
                      >
                        {d.samples.map((s) => (
                          <option key={s.event_id} value={s.event_id}>
                            {`${when(s.occurred_at)} · ${shortRelease(s.release)}${s.device ? ` · ${s.device}` : ""}`}
                          </option>
                        ))}
                      </select>
                    )}
                    {d.symbolicated && (
                      <Segmented size="sm" value={view} onChange={(v) => setView(v as "source" | "raw")} options={[{ value: "source", label: "Source" }, { value: "raw", label: "Raw" }]} />
                    )}
                  </div>
                </div>
                {hasBundleFrames && !d.symbolicated && (
                  <InfoWell style={{ marginBottom: 12 }}>
                    No source map uploaded for this build, so JavaScript lines point into the app bundle.
                    {d.symbolicateError ? ` (${d.symbolicateError})` : ""}
                  </InfoWell>
                )}
                {d.symbolicated && d.symbolicated.missing.length > 0 && (
                  <InfoWell style={{ marginBottom: 12 }}>Some frames had no map: {d.symbolicated.missing.join(", ")}.</InfoWell>
                )}
                {[...exceptions].reverse().map((ex, i) => (
                  <StackTrace key={i} ex={ex} showLibrary={showLibrary} />
                ))}
                {exceptions.some((e) => e.frames.some((f) => !f.in_app) && e.frames.some((f) => f.in_app)) && (
                  <Button size="sm" variant="ghost" onClick={() => setShowLibrary((s) => !s)}>
                    {showLibrary ? "Hide library frames" : "Show library frames"}
                  </Button>
                )}
                {exceptions.length === 0 && <InfoWell>This event has no stack trace.</InfoWell>}

                {(payload?.breadcrumbs?.length ?? 0) > 0 && (
                  <>
                    {section("What happened before")}
                    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {[...(payload?.breadcrumbs ?? [])].reverse().slice(0, 25).map((b, i) => {
                        const data = b.data ?? {};
                        const text =
                          b.message ??
                          [data.method, data.url, data.status_code].filter(Boolean).join(" ") ??
                          "";
                        const nav = data.to ? `→ ${String(data.to)}` : "";
                        return (
                          <li key={i} style={{ display: "grid", gridTemplateColumns: "64px 110px 1fr", gap: 10, padding: "6px 0", font: "400 12.5px/1.45 var(--font-ui)", borderTop: i ? "1px solid var(--line)" : undefined }}>
                            <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{crumbTime(b.timestamp, d.event!.occurred_at)}</span>
                            <span style={{ color: b.level === "error" ? "var(--danger-text)" : "var(--ink-2)", overflowWrap: "anywhere" }}>{b.category ?? b.type ?? ""}</span>
                            <span style={{ color: "var(--ink-2)", overflowWrap: "anywhere" }}>{text || nav || "—"}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </>
                )}

                {section("Device and app")}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
                  <Fact label="Device" value={d.event.device ?? "—"} />
                  <Fact label="OS" value={d.event.os ?? "—"} />
                  <Fact label="App" value={shortRelease(d.event.release)} sub={d.event.environment ?? undefined} />
                  <Fact label="When" value={when(d.event.occurred_at)} sub={app.in_foreground === false ? "app in background" : app.in_foreground === true ? "app open" : undefined} />
                  {ota.update_id ? <Fact label="OTA update" value={String(ota.channel ?? "—")} sub={`${String(ota.update_id).slice(0, 8)}${ota.is_embedded_launch ? ", embedded" : ""}`} /> : null}
                  {d.event.user_id && (
                    <div>
                      <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>User</div>
                      <Button size="sm" variant="ghost" icon={<Icons.Copy />} onClick={() => copy(d.event!.user_id!)}>
                        Copy user id
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <InfoWell style={{ marginTop: 20 }}>No sample stored for this issue.</InfoWell>
            )}
          </>
        )}
      </div>
    </SideDrawer>
  );
}
