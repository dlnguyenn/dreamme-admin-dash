"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { PageHeader } from "./Shell";

type DetectScores = Record<string, unknown>;

type BypassResult = {
  runId: string;
  version: string;
  strength: string;
  inputUrl: string;
  outputUrl: string;
};

export function SynthIDResearch() {
  const toast = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<"v3" | "v4">("v3");
  const [strength, setStrength] = React.useState("final");

  const [detecting, setDetecting] = React.useState(false);
  const [bypassing, setBypassing] = React.useState(false);
  const [scores, setScores] = React.useState<DetectScores | null>(null);
  const [postScores, setPostScores] = React.useState<DetectScores | null>(null);
  const [result, setResult] = React.useState<BypassResult | null>(null);

  // Preview URL is an object URL — revoke when it changes / unmounts so we
  // don't leak blob memory while the user keeps swapping images.
  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setScores(null);
    setPostScores(null);
    setResult(null);
  };

  const detect = async (which: "pre" | "post") => {
    const target = which === "pre" ? file : null;
    let blob: Blob | null = target;
    if (which === "post" && result) {
      const r = await fetch(result.outputUrl);
      blob = await r.blob();
    }
    if (!blob) return;
    setDetecting(true);
    try {
      const fd = new FormData();
      fd.append("image", blob, "image.png");
      const res = await fetch("/api/research/synthid/detect", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "detect failed");
      if (which === "pre") setScores(json.scores);
      else setPostScores(json.scores);
    } catch (e) {
      toast(`Detect failed: ${(e as Error).message}`);
    } finally {
      setDetecting(false);
    }
  };

  const bypass = async () => {
    if (!file) return;
    setBypassing(true);
    setResult(null);
    setPostScores(null);
    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      fd.append("version", version);
      fd.append("strength", strength);
      const res = await fetch("/api/research/synthid/bypass", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "bypass failed");
      setResult(json);
    } catch (e) {
      toast(`Bypass failed: ${(e as Error).message}`);
    } finally {
      setBypassing(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Research · Internal only"
        title="SynthID Research"
        subtitle="Upload a Gemini-generated image to inspect SynthID detector scores and try the V3/V4 bypass. Output stays in the research bucket — do not publish."
      />

      <div
        style={{
          padding: "12px 14px",
          marginBottom: 20,
          borderRadius: 10,
          background: "color-mix(in oklab, var(--accent) 8%, transparent)",
          border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)",
          fontSize: 12,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        <strong>Research only.</strong> Removing SynthID likely violates the
        Gemini API ToS, and the upstream tool's license restricts use to
        academic research / security analysis. Do not pipe output from this
        page into the customer-facing Content Pipeline.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div>
          <Section title="1. Upload">
            <input
              type="file"
              accept="image/*"
              onChange={onPick}
              style={{ fontSize: 13 }}
            />
            {file && (
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
          </Section>

          <Section title="2. Before / After">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <ImageSlot label="Input" url={previewUrl} />
              <ImageSlot label="Bypassed" url={result?.outputUrl ?? null} />
            </div>
          </Section>

          <Section title="3. Detector scores">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <ScoresPanel
                label="On input"
                scores={scores}
                onRun={() => detect("pre")}
                disabled={!file || detecting}
                loading={detecting}
              />
              <ScoresPanel
                label="On bypassed"
                scores={postScores}
                onRun={() => detect("post")}
                disabled={!result || detecting}
                loading={detecting}
              />
            </div>
          </Section>
        </div>

        <aside
          style={{
            padding: 18,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            position: "sticky",
            top: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
            Bypass settings
          </div>

          <Field label="Version">
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value as "v3" | "v4")}
              style={inputStyle}
            >
              <option value="v3">V3 (CPU, fast)</option>
              <option value="v4">V4 (GPU, full pipeline)</option>
            </select>
          </Field>

          <Field label="Strength">
            <select
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              style={inputStyle}
            >
              <option value="light">light</option>
              <option value="medium">medium</option>
              <option value="strong">strong</option>
              <option value="final">final</option>
            </select>
          </Field>

          <Button
            variant="primary"
            onClick={bypass}
            disabled={!file || bypassing}
            style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
          >
            {bypassing ? "Running…" : "Run bypass"}
          </Button>

          {result && (
            <div
              style={{
                marginTop: 14,
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                color: "var(--ink-3)",
                wordBreak: "break-all",
              }}
            >
              run: {result.runId}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--ink-3)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  background: "var(--surface)",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  color: "var(--ink)",
};

function ImageSlot({ label, url }: { label: string; url: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 6 }}>{label}</div>
      <div
        style={{
          aspectRatio: "1 / 1",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>—</span>
        )}
      </div>
    </div>
  );
}

function ScoresPanel({
  label,
  scores,
  onRun,
  disabled,
  loading,
}: {
  label: string;
  scores: DetectScores | null;
  onRun: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{label}</div>
        <Button variant="ghost" onClick={onRun} disabled={disabled}>
          {loading ? "…" : "Detect"}
        </Button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          color: "var(--ink-2)",
          minHeight: 120,
          maxHeight: 240,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {scores ? JSON.stringify(scores, null, 2) : "—"}
      </pre>
    </div>
  );
}
