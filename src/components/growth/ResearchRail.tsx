"use client";

/**
 * Deep Research rail — Lightreel-style viral-content research from the
 * Analyst tab. Creates a run, then drives it with a client stepper loop
 * (each /step call executes one bounded phase server-side and persists,
 * so closing the tab never loses work — Resume picks up mid-run).
 */

import * as React from "react";
import { timeAgo, MarkdownLite } from "./shared";

const SUGGESTIONS = [
  "Look for viral B2C app videos with a food scanner or in the health niche",
  "What viral formats are GLP-1 / weight-loss creators using that an app could own?",
  "Find viral videos about protein tracking or macro counting apps",
];

const PHASES = [
  { key: "planning", label: "Plan searches" },
  { key: "seeding", label: "Seed search" },
  { key: "expanding", label: "Mine native phrases" },
  { key: "inspecting", label: "Watch videos" },
  { key: "synthesizing", label: "Write memo" },
] as const;

interface Progress {
  phase: string;
  label: string;
  inspected: number;
  shortlist: number;
  candidates: number;
  strong: number;
}

interface RunCandidate {
  url: string;
  author: string;
  views: number;
  outlier_score?: number | null;
  strong?: boolean;
  coding?: { app_visibility: number; app_name: string; why_it_hit: string } | null;
}

interface ResearchRunLite {
  id: string;
  question: string;
  status: string;
  report_md: string | null;
  error: string | null;
  created_at: string;
  phase_state?: { candidates?: RunCandidate[] };
  progress?: Progress;
}

const ACTIVE_STATUSES = new Set(["planning", "seeding", "expanding", "inspecting", "synthesizing"]);

export function ResearchRail() {
  const [runs, setRuns] = React.useState<ResearchRunLite[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState("");
  const [stepping, setStepping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loopAlive = React.useRef(false);

  const selected = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/growth/research");
        const body = (await res.json()) as { runs?: ResearchRunLite[] };
        if (alive && res.ok && body.runs) setRuns(body.runs);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const upsertRun = React.useCallback((run: ResearchRunLite) => {
    setRuns((cur) => {
      const i = cur.findIndex((r) => r.id === run.id);
      if (i < 0) return [run, ...cur];
      const next = [...cur];
      next[i] = run;
      return next;
    });
  }, []);

  const stepLoop = React.useCallback(
    async (runId: string) => {
      if (loopAlive.current) return;
      loopAlive.current = true;
      setStepping(true);
      setError(null);
      try {
        // Hard iteration cap: a full run is ~8-10 steps; 40 is a runaway guard.
        for (let i = 0; i < 40 && loopAlive.current; i++) {
          const res = await fetch("/api/growth/research/step", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ run_id: runId }),
          });
          const body = (await res.json()) as { run?: ResearchRunLite; progress?: Progress; error?: string };
          if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
          if (body.run) upsertRun({ ...body.run, progress: body.progress });
          const status = body.run?.status ?? "failed";
          if (status === "done") break;
          if (status === "failed") {
            setError(body.run?.error ?? "run failed");
            break;
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        loopAlive.current = false;
        setStepping(false);
      }
    },
    [upsertRun],
  );

  const start = async () => {
    const q = question.trim();
    if (q.length < 10) return;
    setError(null);
    try {
      const res = await fetch("/api/growth/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const body = (await res.json()) as { run?: ResearchRunLite; progress?: Progress; error?: string };
      if (!res.ok || body.error || !body.run) throw new Error(body.error ?? `HTTP ${res.status}`);
      upsertRun({ ...body.run, progress: body.progress });
      setSelectedId(body.run.id);
      setQuestion("");
      void stepLoop(body.run.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const mono: React.CSSProperties = { fontFamily: "var(--font-geist-mono), monospace" };
  const isActive = selected ? ACTIVE_STATUSES.has(selected.status) : false;
  const strongFinds = (selected?.phase_state?.candidates ?? []).filter((c) => c.strong);

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      {/* ---- launcher card ---- */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          background:
            "linear-gradient(160deg, color-mix(in oklab, var(--p-emma) 18%, var(--surface)), color-mix(in oklab, var(--p-andrea) 14%, var(--surface)))",
          boxShadow: "var(--shadow-sm)",
          padding: 18,
        }}
      >
        <div style={{ ...mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ink-3)", marginBottom: 6 }}>
          Deep research · Lightreel-style
        </div>
        <div className="serif" style={{ fontSize: 20, letterSpacing: "-0.02em", marginBottom: 6 }}>
          Research a content vein end-to-end
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 12px" }}>
          Seeds adjacent categories in native viewer language, scores finds against each
          creator&apos;s own baseline, <strong>watches the videos</strong> (app visibility 0–3),
          and writes a memo with format verdicts + repeatable series.
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Look for viral B2C app videos with a food scanner or in the health niche"
          rows={2}
          disabled={stepping}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "none",
            padding: "9px 12px",
            fontSize: 12.5,
            lineHeight: 1.5,
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontFamily: "inherit",
            outline: "none",
            marginBottom: 8,
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => void start()}
            disabled={stepping || question.trim().length < 10}
            style={{
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              border: "1px solid var(--ink)",
              background: stepping || question.trim().length < 10 ? "var(--surface-2)" : "var(--ink)",
              color: stepping || question.trim().length < 10 ? "var(--ink-4)" : "var(--surface)",
              cursor: stepping || question.trim().length < 10 ? "default" : "pointer",
            }}
          >
            🔍 Run deep research
          </button>
          <span style={{ ...mono, fontSize: 10.5, color: "var(--ink-3)" }}>~$0.65 · 5–10 min</span>
        </div>
        {!question && !stepping && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setQuestion(s)}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {s.length > 64 ? `${s.slice(0, 61)}…` : s}
              </button>
            ))}
          </div>
        )}
        {error && <div style={{ marginTop: 10, fontSize: 12, color: "var(--accent)" }}>{error}</div>}
      </div>

      {/* ---- history pills ---- */}
      {runs.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {runs.map((r) => {
            const active = selected?.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                title={r.question}
                style={{
                  ...mono,
                  fontSize: 10.5,
                  padding: "4px 11px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
                  background: active ? "var(--ink)" : "var(--surface)",
                  color: active ? "var(--surface)" : "var(--ink-2)",
                  cursor: "pointer",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.status === "done" ? "✓" : r.status === "failed" ? "⚠" : "◌"} {r.question}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- selected run ---- */}
      {selected && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
            padding: 18,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{selected.question}</div>
            <span style={{ ...mono, fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
              {timeAgo(selected.created_at)}
            </span>
          </div>

          {/* phase progress */}
          {selected.status !== "done" && (
            <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              {PHASES.map((p, i) => {
                const currentIdx = PHASES.findIndex((x) => x.key === selected.status);
                const isCurrent = p.key === selected.status;
                const isDone = currentIdx > i || selected.status === "done";
                const detail =
                  isCurrent && p.key === "inspecting" && selected.progress
                    ? ` ${selected.progress.inspected}/${selected.progress.shortlist}`
                    : "";
                return (
                  <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: isDone ? "var(--good, #22a06b)" : isCurrent ? "var(--accent)" : "var(--line)",
                        animation: isCurrent && stepping ? "pulse 1.2s ease-in-out infinite" : undefined,
                      }}
                    />
                    <span style={{ color: isDone || isCurrent ? "var(--ink)" : "var(--ink-4)" }}>
                      {p.label}
                      {detail}
                    </span>
                  </div>
                );
              })}
              {selected.progress && selected.progress.candidates > 0 && (
                <div style={{ ...mono, fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
                  {selected.progress.candidates} candidates · {selected.progress.strong} strong finds
                </div>
              )}
              <style>{`@keyframes pulse { 0%,100% { opacity: .3; transform: scale(.85);} 50% { opacity: 1; transform: scale(1);} }`}</style>
            </div>
          )}

          {/* resume / retry */}
          {!stepping && (isActive || selected.status === "failed") && (
            <div style={{ marginBottom: 12 }}>
              {selected.status === "failed" && (
                <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 8 }}>{selected.error}</div>
              )}
              <button
                onClick={() => void stepLoop(selected.id)}
                style={{
                  padding: "7px 14px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  borderRadius: 10,
                  border: "1px solid var(--ink)",
                  background: "var(--ink)",
                  color: "var(--surface)",
                  cursor: "pointer",
                }}
              >
                {selected.status === "failed" ? "Retry from where it failed" : "Resume run"}
              </button>
            </div>
          )}

          {/* strong finds strip */}
          {strongFinds.length > 0 && (
            <div style={{ marginBottom: selected.report_md ? 14 : 0 }}>
              <div style={{ ...mono, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ink-3)", marginBottom: 6 }}>
                Strong finds · {strongFinds.length} · app-visible ones feed Inspo
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {strongFinds.slice(0, 8).map((c) => (
                  <a
                    key={c.url}
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "baseline",
                      fontSize: 12,
                      color: "var(--ink)",
                      textDecoration: "none",
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--surface-2)",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>@{c.author}</span>
                    <span style={{ ...mono, fontSize: 10.5, color: "var(--ink-3)" }}>
                      {c.views >= 1_000_000 ? `${(c.views / 1_000_000).toFixed(1)}M` : `${Math.round(c.views / 1000)}K`} views
                      {c.outlier_score ? ` · ${c.outlier_score.toFixed(1)}× baseline` : ""}
                      {c.coding ? ` · app vis ${c.coding.app_visibility}/3` : ""}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* memo */}
          {selected.report_md && (
            <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 0, overflowWrap: "break-word" }}>
              <MarkdownLite text={selected.report_md} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
