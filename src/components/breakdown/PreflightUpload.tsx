"use client";

/**
 * Pre-flight an unaired cut: the browser uploads the file straight to
 * Storage with a signed URL (Vercel bodies cap at 4.5 MB), then the
 * pipeline grades it. Past uploads are listed so a cut can be reopened.
 */

import * as React from "react";
import type { BreakdownRow } from "@/lib/ad-breakdown/pipeline";
import { BreakdownPanel } from "./BreakdownPanel";

type Listed = Pick<BreakdownRow, "id" | "source_key" | "name" | "status" | "scores" | "duration_s" | "created_at">;

export function PreflightUpload() {
  const [progress, setProgress] = React.useState<number | null>(null);
  const [stage, setStage] = React.useState<"idle" | "uploading" | "grading" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [current, setCurrent] = React.useState<BreakdownRow | null>(null);
  const [past, setPast] = React.useState<Listed[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const refreshPast = React.useCallback(() => {
    fetch("/api/ad-breakdown?kind=upload&limit=30")
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: Listed[] }>) : { rows: [] }))
      .then((b) => setPast(b.rows ?? []))
      .catch(() => {});
  }, []);

  React.useEffect(refreshPast, [refreshPast]);

  const onFile = async (file: File) => {
    setError(null);
    setCurrent(null);
    setStage("uploading");
    setProgress(0);
    try {
      const sign = await fetch("/api/ad-breakdown/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content_type: file.type || "video/mp4", size: file.size }),
      });
      const signed = (await sign.json()) as { path: string; upload_url: string; name: string; error?: string };
      if (!sign.ok || signed.error) throw new Error(signed.error ?? `HTTP ${sign.status}`);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.upload_url);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.setRequestHeader("x-upsert", "true");
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`upload failed: HTTP ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("upload failed"));
        xhr.send(file);
      });

      setStage("grading");
      const res = await fetch("/api/ad-breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_path: signed.path, name: signed.name }),
      });
      const row = (await res.json()) as BreakdownRow & { error?: string };
      if (!res.ok || row.error) throw new Error(row.error ?? `HTTP ${res.status}`);
      setCurrent(row);
      setStage("idle");
      refreshPast();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const openPast = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/ad-breakdown?id=${id}`);
    if (res.ok) setCurrent((await res.json()) as BreakdownRow);
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ padding: 16, borderRadius: 12, border: "1px dashed var(--line-2)", background: "var(--surface-2)", display: "grid", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
          Drop in a cut before it spends a dollar. Gemini watches and listens, then grades it against Motion's
          winning-ad formula and predicts the hook and hold band. About a minute, a few cents.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          disabled={stage === "uploading" || stage === "grading"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
          style={{ fontSize: 12 }}
        />
        {stage === "uploading" && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            uploading… {progress ?? 0}%
            <div style={{ height: 4, borderRadius: 2, background: "var(--line)", marginTop: 6 }}>
              <div style={{ width: `${progress ?? 0}%`, height: "100%", borderRadius: 2, background: "var(--ink)" }} />
            </div>
          </div>
        )}
        {stage === "grading" && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>watching, grading, writing the verdict… about 45 s</div>}
        {stage === "error" && error && <div style={{ fontSize: 12, color: "var(--danger-text)" }}>{error}</div>}
      </div>

      {current && (
        <BreakdownPanel key={current.id} uploadPath={current.source_key} name={current.name ?? undefined} initialRow={current} />
      )}

      {past.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ink-3)", marginBottom: 8 }}>
            Previous pre-flights
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
            {past.map((p, i) => (
              <button
                key={p.id}
                onClick={() => void openPast(p.id)}
                style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, width: "100%", textAlign: "left", padding: "8px 12px", background: current?.id === p.id ? "var(--surface-2)" : "var(--surface)", border: "none", borderTop: i ? "1px solid var(--line)" : "none", cursor: "pointer", fontSize: 12.5, color: "var(--ink)" }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name ?? p.source_key.split("/").pop()}</span>
                <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {p.status === "done" && p.scores ? `${p.scores.formula.score}/${p.scores.formula.max} · hook ${p.scores.bands.hook}` : p.status}
                </span>
                <span style={{ color: "var(--ink-4)", fontSize: 11 }}>{new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
