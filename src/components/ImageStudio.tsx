"use client";

import * as React from "react";
import { Button, useToast } from "./ui";
import { PageHeader } from "./Shell";
import { Icons } from "./Icons";

const ASPECT_OPTIONS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
type AspectRatio = (typeof ASPECT_OPTIONS)[number];

interface ImageGenerationRow {
  id: string;
  prompt: string;
  aspect_ratio: string | null;
  image_url: string;
  gemini_model: string | null;
  source: string | null;
  created_at: string;
  reference_urls: string[] | null;
}

type BatchStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

interface ImageBatchSummary {
  batchId: string;
  geminiBatchName: string;
  status: BatchStatus;
  itemCount: number;
  geminiModel: string;
  submittedAt: string;
  completedAt: string | null;
  results:
    | Array<{ prompt: string; imageUrl?: string; error?: string }>
    | null;
  error: string | null;
}

interface ConnectorConfig {
  url: string;
  token: string | null;
  configured: boolean;
}

const PAGE_SIZE = 24;

export function ImageStudio() {
  const toast = useToast();
  const [config, setConfig] = React.useState<ConnectorConfig | null>(null);
  const [configError, setConfigError] = React.useState<string | null>(null);

  const [prompt, setPrompt] = React.useState("");
  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>("1:1");
  const [refUrl, setRefUrl] = React.useState("");
  // Local file picker — alternative to refUrl. When set, sent as
  // base64 to /api/image-studio/generate. UI uses an "either or" toggle:
  // typing a URL clears the file; picking a file clears the URL.
  const [refFile, setRefFile] = React.useState<{
    name: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    base64: string;
    previewUrl: string;
  } | null>(null);
  const refFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [count, setCount] = React.useState<number>(1);
  const [generating, setGenerating] = React.useState(false);
  const [latest, setLatest] = React.useState<ImageGenerationRow[]>([]);

  const [rows, setRows] = React.useState<ImageGenerationRow[]>([]);
  const [page, setPage] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingGallery, setLoadingGallery] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<ImageGenerationRow | null>(null);

  const [batches, setBatches] = React.useState<ImageBatchSummary[]>([]);
  const [batchesError, setBatchesError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/mcp-image-token");
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "failed");
        if (!cancelled) {
          setConfig({
            url: json.url,
            token: json.token,
            configured: !!json.configured,
          });
        }
      } catch (e) {
        if (!cancelled) setConfigError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadGallery = React.useCallback(async (nextPage: number) => {
    setLoadingGallery(true);
    setGalleryError(null);
    try {
      const res = await fetch(
        `/api/image-studio/list?limit=${PAGE_SIZE}&offset=${nextPage * PAGE_SIZE}`,
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setRows(json.rows ?? []);
      setHasMore((json.rows?.length ?? 0) === PAGE_SIZE);
      setPage(nextPage);
    } catch (e) {
      setGalleryError((e as Error).message);
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  React.useEffect(() => {
    loadGallery(0);
  }, [loadGallery]);

  const loadBatches = React.useCallback(async () => {
    try {
      const res = await fetch("/api/image-studio/batch/list?limit=20");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "failed");
      setBatches(json.batches ?? []);
      setBatchesError(null);
    } catch (e) {
      setBatchesError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  // Auto-poll non-terminal batches every 30s. For each pending/running
  // batch we hit /api/image-studio/batch/[id], which calls
  // getImageBatch() server-side — that lazily polls Gemini and inserts
  // image_generations rows on completion. When any batch flips to
  // SUCCEEDED we refresh the gallery so the new images appear.
  //
  // The effect must NOT re-run on every batch state change (it would
  // restart the interval on every tick → effective 0s polling). Track
  // pending IDs as a stable signature, and read the latest batches via
  // a ref inside tick().
  const batchesRef = React.useRef(batches);
  React.useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  const pendingSignature = React.useMemo(
    () =>
      batches
        .filter((b) => b.status === "PENDING" || b.status === "RUNNING")
        .map((b) => b.batchId)
        .sort()
        .join(","),
    [batches],
  );

  React.useEffect(() => {
    if (!pendingSignature) return;

    const tick = async () => {
      const pendingNow = batchesRef.current.filter(
        (b) => b.status === "PENDING" || b.status === "RUNNING",
      );
      if (pendingNow.length === 0) return;
      const updated: ImageBatchSummary[] = [];
      let anyCompleted = false;
      for (const b of pendingNow) {
        try {
          const res = await fetch(
            `/api/image-studio/batch/${encodeURIComponent(b.batchId)}`,
          );
          const json = await res.json();
          if (!json.ok) continue;
          const next = json.batch as ImageBatchSummary;
          if (next.status === "SUCCEEDED") anyCompleted = true;
          updated.push(next);
        } catch {
          // Transient — keep retrying on next tick.
        }
      }
      if (updated.length > 0) {
        setBatches((prev) => {
          const byId = new Map(updated.map((u) => [u.batchId, u]));
          return prev.map((b) => byId.get(b.batchId) ?? b);
        });
      }
      if (anyCompleted) loadGallery(0);
    };

    const interval = window.setInterval(tick, 30_000);
    void tick();
    return () => window.clearInterval(interval);
  }, [pendingSignature, loadGallery]);

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    const trimmedRef = refUrl.trim();
    if (trimmedRef && !/^https?:\/\//i.test(trimmedRef)) {
      toast("Reference URL must start with http(s)://");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/image-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspectRatio,
          referenceImageUrl:
            refFile == null && trimmedRef ? trimmedRef : undefined,
          referenceImageBase64: refFile?.base64,
          referenceImageMimeType: refFile?.mimeType,
          count: count > 1 ? count : undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        if (res.status === 429) {
          toast(`Rate limited: ${json.error}`);
        } else {
          toast(`Failed: ${json.error ?? "unknown error"}`);
        }
        return;
      }
      const results = (json.results ?? [json.result]) as Array<{
        id: string;
        imageUrl: string;
        prompt: string;
        aspectRatio: string | null;
        geminiModel: string;
        createdAt: string;
        referenceImageUrl: string | null;
      }>;
      const rows: ImageGenerationRow[] = results.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        aspect_ratio: r.aspectRatio,
        image_url: r.imageUrl,
        gemini_model: r.geminiModel,
        source: "dashboard",
        created_at: r.createdAt,
        reference_urls: r.referenceImageUrl ? [r.referenceImageUrl] : null,
      }));
      setLatest(rows);
      loadGallery(0);
    } catch (e) {
      toast(`Failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  // Submit the same form as a Gemini Batch job (50% off list, 2-6h
  // turnaround). Each requested variation becomes one batch item with
  // the same prompt + reference. Result lands in the Batches panel and
  // auto-polls until SUCCEEDED.
  const submitAsBatch = async () => {
    if (!prompt.trim() || generating) return;
    const trimmedRef = refUrl.trim();
    if (trimmedRef && !/^https?:\/\//i.test(trimmedRef)) {
      toast("Reference URL must start with http(s)://");
      return;
    }
    const itemBlueprint = {
      prompt: prompt.trim(),
      aspectRatio,
      referenceImageUrl:
        refFile == null && trimmedRef ? trimmedRef : undefined,
      referenceImageBase64: refFile?.base64,
      referenceImageMimeType: refFile?.mimeType,
    };
    const items = Array.from({ length: count }, () => itemBlueprint);
    setGenerating(true);
    try {
      const res = await fetch("/api/image-studio/batch/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!json.ok) {
        if (res.status === 429) {
          toast(`Rate limited: ${json.error}`);
        } else {
          toast(`Batch submit failed: ${json.error ?? "unknown error"}`);
        }
        return;
      }
      const batch = json.batch as ImageBatchSummary;
      // Optimistically prepend so the Batches panel shows it
      // immediately; the auto-poller will pick up status updates.
      setBatches((prev) => [batch, ...prev]);
      toast(
        `Batch submitted (${batch.itemCount} items). Results in ~2-6 h.`,
      );
    } catch (e) {
      toast(`Batch submit failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast("Copy failed");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Internal · Admin only"
        title="Image Studio"
        subtitle="Generate images with Gemini, plus a self-hosted MCP endpoint that Claude (claude.ai connectors and Claude Code) can call as a tool. All generations are recorded in the gallery below."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 24,
          alignItems: "start",
          marginBottom: 32,
        }}
      >
        <div>
          <Section title="1. Generate">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A photorealistic golden retriever puppy reading a vintage hardcover book in a cozy library, soft window light"
              rows={4}
              style={{
                ...inputStyle,
                fontFamily: "inherit",
                resize: "vertical",
                minHeight: 96,
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 12,
                flexWrap: "wrap",
              }}
            >
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                style={{ ...inputStyle, width: "auto" }}
              >
                {ASPECT_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ ...inputStyle, width: "auto" }}
                title="Number of variations (parallel generations sharing the same prompt + reference)"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}× {n === 1 ? "image" : "images"}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                onClick={generate}
                disabled={generating || !prompt.trim()}
              >
                {generating ? "Generating…" : "Generate"}
              </Button>
              <Button
                variant="secondary"
                onClick={submitAsBatch}
                disabled={generating || !prompt.trim()}
                title="Submit as a Gemini Batch job — 50% off list price, results arrive in 2-6 h. Tracked in the Batches panel below."
              >
                {generating ? "…" : "Submit as Batch (50% off)"}
              </Button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginBottom: 6,
                }}
              >
                Reference image (optional — image-to-image). Paste a URL or
                upload a local file (max 8 MB, png/jpeg/webp/gif).
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={refUrl}
                  onChange={(e) => {
                    setRefUrl(e.target.value);
                    if (e.target.value && refFile) {
                      // Picking a URL clears the uploaded file (mutex).
                      setRefFile(null);
                      if (refFileInputRef.current) {
                        refFileInputRef.current.value = "";
                      }
                    }
                  }}
                  style={inputStyle}
                  disabled={refFile != null}
                />
                <input
                  ref={refFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 8 * 1024 * 1024) {
                      toast("File exceeds 8 MB");
                      e.target.value = "";
                      return;
                    }
                    const allowed = new Set([
                      "image/png",
                      "image/jpeg",
                      "image/webp",
                      "image/gif",
                    ]);
                    if (!allowed.has(file.type)) {
                      toast(`Unsupported type: ${file.type || "unknown"}`);
                      e.target.value = "";
                      return;
                    }
                    const buf = await file.arrayBuffer();
                    const bytes = new Uint8Array(buf);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++) {
                      binary += String.fromCharCode(bytes[i]);
                    }
                    const base64 = btoa(binary);
                    setRefFile({
                      name: file.name,
                      mimeType: file.type as
                        | "image/png"
                        | "image/jpeg"
                        | "image/webp"
                        | "image/gif",
                      base64,
                      previewUrl: URL.createObjectURL(file),
                    });
                    setRefUrl("");
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refFileInputRef.current?.click()}
                  disabled={refUrl.trim().length > 0}
                >
                  Upload
                </Button>
              </div>
              {refFile && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 8,
                    padding: "6px 8px",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={refFile.previewUrl}
                    alt="reference preview"
                    style={{
                      width: 36,
                      height: 36,
                      objectFit: "cover",
                      borderRadius: 4,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      fontSize: 11,
                      color: "var(--ink-2)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={refFile.name}
                  >
                    {refFile.name}
                  </div>
                  <button
                    onClick={() => {
                      URL.revokeObjectURL(refFile.previewUrl);
                      setRefFile(null);
                      if (refFileInputRef.current) {
                        refFileInputRef.current.value = "";
                      }
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--ink-3)",
                      padding: 0,
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                    aria-label="Remove uploaded reference"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </Section>

          <Section title="2. Latest">
            {latest.length === 0 ? (
              <div
                style={{
                  aspectRatio: aspectRatioToCss(aspectRatio),
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  maxHeight: 520,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--ink-4)" }}>—</span>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    latest.length === 1
                      ? "1fr"
                      : `repeat(${Math.min(latest.length, 2)}, minmax(0, 1fr))`,
                  gap: 10,
                }}
              >
                {latest.map((row) => (
                  <div key={row.id}>
                    <div
                      style={{
                        aspectRatio: aspectRatioToCss(row.aspect_ratio),
                        background: "var(--surface-2)",
                        border: "1px solid var(--line)",
                        borderRadius: 10,
                        overflow: "hidden",
                        maxHeight: 520,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={row.image_url}
                        alt={row.prompt}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Icons.Copy />}
                        onClick={() => copy(row.image_url, "Image URL copied")}
                      >
                        Copy URL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          window.open(row.image_url, "_blank", "noopener")
                        }
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRefUrl(row.image_url)}
                        title="Use this image as the reference for the next generation"
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            MCP connector config
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            Paste these into claude.ai → Settings → Connectors → Add custom
            connector. The connector then shows up as an MCP tool across all
            Claude projects (web + Claude Code).
          </div>

          <Field label="URL">
            <div style={{ display: "flex", gap: 6 }}>
              <input
                readOnly
                value={config?.url ?? "loading…"}
                style={{ ...inputStyle, fontSize: 12 }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<Icons.Copy />}
                onClick={() => config?.url && copy(config.url, "URL copied")}
                disabled={!config?.url}
              >
                {""}
              </Button>
            </div>
          </Field>

          <Field label="Bearer token">
            {!config ? (
              <div style={{ fontSize: 12, color: "var(--ink-4)" }}>loading…</div>
            ) : config.configured && config.token ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Icons.Copy />}
                onClick={() => copy(config.token!, "Token copied")}
                style={{ width: "100%", justifyContent: "center" }}
              >
                Copy bearer token
              </Button>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--accent)",
                  lineHeight: 1.5,
                }}
              >
                MCP_IMAGE_BEARER_TOKEN not set on the server. Configure it in
                Vercel project env vars before adding the connector.
              </div>
            )}
          </Field>

          {configError && (
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "var(--accent)",
              }}
            >
              {configError}
            </div>
          )}
        </aside>
      </div>

      {batches.length > 0 && (
        <Section title="Batches">
          {batchesError && (
            <div
              style={{
                fontSize: 12,
                color: "var(--accent)",
                marginBottom: 12,
              }}
            >
              {batchesError}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginBottom: 10,
            }}
          >
            Async Gemini Batch jobs (50% off list price; SLA 24 h, typical
            2-6 h). The dashboard auto-polls every 30 s and refreshes the
            gallery when a batch completes.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 8,
            }}
          >
            {batches.map((b) => {
              const succeeded = b.results?.filter((r) => r.imageUrl).length ?? 0;
              const failed = b.results?.filter((r) => r.error).length ?? 0;
              return (
                <div
                  key={b.batchId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                  }}
                >
                  <span
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      fontFamily: "var(--font-geist-mono), monospace",
                      borderRadius: 6,
                      color: "white",
                      background:
                        b.status === "SUCCEEDED"
                          ? "var(--ok, #2c7)"
                          : b.status === "FAILED" || b.status === "CANCELLED"
                            ? "var(--accent)"
                            : "var(--ink-3)",
                    }}
                  >
                    {b.status}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                    title={b.batchId}
                  >
                    {b.batchId.slice(0, 8)}…
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {b.itemCount} item{b.itemCount === 1 ? "" : "s"}
                    {b.results &&
                      ` · ${succeeded} ok${failed > 0 ? ` / ${failed} failed` : ""}`}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ink-4)",
                      marginLeft: "auto",
                    }}
                  >
                    {new Date(b.submittedAt).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Gallery">
        {galleryError && (
          <div
            style={{
              fontSize: 12,
              color: "var(--accent)",
              marginBottom: 12,
            }}
          >
            {galleryError}
          </div>
        )}
        {rows.length === 0 && !loadingGallery && (
          <div
            style={{
              padding: 32,
              border: "1px dashed var(--line)",
              borderRadius: 10,
              textAlign: "center",
              color: "var(--ink-3)",
              fontStyle: "italic",
            }}
            className="serif"
          >
            No images generated yet.
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => setActive(row)}
              style={{
                padding: 0,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: 10,
                overflow: "hidden",
                cursor: "pointer",
                aspectRatio: "1 / 1",
                display: "flex",
                position: "relative",
              }}
              title={row.prompt}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.image_url}
                alt={row.prompt}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              {row.reference_urls && row.reference_urls.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    padding: "2px 6px",
                    fontSize: 10,
                    fontFamily: "var(--font-geist-mono), monospace",
                    background: "color-mix(in oklab, black 65%, transparent)",
                    color: "white",
                    borderRadius: 6,
                  }}
                  title="Generated from a reference image"
                >
                  edit
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadGallery(Math.max(0, page - 1))}
            disabled={page === 0 || loadingGallery}
          >
            ← Prev
          </Button>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Page {page + 1}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadGallery(page + 1)}
            disabled={!hasMore || loadingGallery}
          >
            Next →
          </Button>
        </div>
      </Section>

      {active && (
        <Modal onClose={() => setActive(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.image_url}
            alt={active.prompt}
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
              borderRadius: 8,
              background: "var(--surface-2)",
            }}
          />
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 12,
              maxHeight: 120,
              overflowY: "auto",
            }}
          >
            {active.prompt}
          </div>
          {active.reference_urls && active.reference_urls.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-3)" }}>
              Reference:{" "}
              <a
                href={active.reference_urls[0]}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--ink-2)" }}
              >
                {active.reference_urls[0]}
              </a>
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontFamily: "var(--font-geist-mono), monospace",
              marginTop: 8,
            }}
          >
            {active.aspect_ratio ?? "—"} ·{" "}
            {active.gemini_model ?? "?"} ·{" "}
            {new Date(active.created_at).toLocaleString()} ·{" "}
            {active.source ?? "?"}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              size="sm"
              icon={<Icons.Copy />}
              onClick={() => copy(active.image_url, "URL copied")}
            >
              Copy URL
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(active.image_url, "_blank", "noopener")}
            >
              Open full-res
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(active.prompt, "Prompt copied")}
            >
              Copy prompt
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRefUrl(active.image_url);
                setActive(null);
              }}
            >
              Edit this image
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function aspectRatioToCss(a: string | null | undefined): string {
  if (!a) return "1 / 1";
  const m = /^(\d+):(\d+)$/.exec(a);
  if (!m) return "1 / 1";
  return `${m[1]} / ${m[2]}`;
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
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
        {label}
      </div>
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

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklab, black 55%, transparent)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 20,
          maxWidth: 720,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
