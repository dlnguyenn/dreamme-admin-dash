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
  batch_id: string | null;
}

interface GeneratedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  aspectRatio: string | null;
  geminiModel: string;
  createdAt: string;
  referenceUrls: string[];
  batchId: string;
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
  const [count, setCount] = React.useState<number>(1);
  const [refUrls, setRefUrls] = React.useState<string[]>([]);
  const [refDraft, setRefDraft] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [latest, setLatest] = React.useState<GeneratedImage[]>([]);

  const [rows, setRows] = React.useState<ImageGenerationRow[]>([]);
  const [page, setPage] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingGallery, setLoadingGallery] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<ImageGenerationRow | null>(null);

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

  const addRefUrl = () => {
    const v = refDraft.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) {
      toast("Reference URL must start with http(s)://");
      return;
    }
    if (refUrls.length >= 3) {
      toast("Maximum 3 reference images");
      return;
    }
    if (refUrls.includes(v)) {
      setRefDraft("");
      return;
    }
    setRefUrls([...refUrls, v]);
    setRefDraft("");
  };

  const removeRefUrl = (url: string) => {
    setRefUrls(refUrls.filter((u) => u !== url));
  };

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/image-studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspectRatio,
          count,
          referenceImageUrls: refUrls.length ? refUrls : undefined,
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
      const images: GeneratedImage[] = (json.images ?? []).map(
        (img: {
          id: string;
          imageUrl: string;
          prompt: string;
          aspectRatio: string | null;
          geminiModel: string;
          createdAt: string;
          referenceUrls: string[];
          batchId: string;
        }) => ({
          id: img.id,
          imageUrl: img.imageUrl,
          prompt: img.prompt,
          aspectRatio: img.aspectRatio,
          geminiModel: img.geminiModel,
          createdAt: img.createdAt,
          referenceUrls: img.referenceUrls ?? [],
          batchId: img.batchId,
        }),
      );
      setLatest(images);
      // Refresh gallery from page 0 so new images show up.
      loadGallery(0);
    } catch (e) {
      toast(`Failed: ${(e as Error).message}`);
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
                title="Number of variations"
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
            </div>
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginBottom: 6,
                }}
              >
                Reference images (optional, max 3)
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={refDraft}
                  onChange={(e) => setRefDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRefUrl();
                    }
                  }}
                  style={inputStyle}
                  disabled={refUrls.length >= 3}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addRefUrl}
                  disabled={!refDraft.trim() || refUrls.length >= 3}
                >
                  Add
                </Button>
              </div>
              {refUrls.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  {refUrls.map((u) => (
                    <span
                      key={u}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        background: "var(--surface-2)",
                        border: "1px solid var(--line)",
                        borderRadius: 14,
                        maxWidth: 280,
                      }}
                      title={u}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {u}
                      </span>
                      <button
                        onClick={() => removeRefUrl(u)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--ink-3)",
                          padding: 0,
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                        aria-label={`Remove ${u}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
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
                {latest.map((img) => (
                  <div key={img.id}>
                    <div
                      style={{
                        aspectRatio: aspectRatioToCss(img.aspectRatio),
                        background: "var(--surface-2)",
                        border: "1px solid var(--line)",
                        borderRadius: 10,
                        overflow: "hidden",
                        maxHeight: 520,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.imageUrl}
                        alt={img.prompt}
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
                        onClick={() => copy(img.imageUrl, "Image URL copied")}
                      >
                        Copy URL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          window.open(img.imageUrl, "_blank", "noopener")
                        }
                      >
                        Open
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
          {rows.map((row) => {
            const batchSize = row.batch_id
              ? rows.filter((r) => r.batch_id === row.batch_id).length
              : 1;
            return (
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
                {batchSize > 1 && (
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
                  >
                    of {batchSize}
                  </span>
                )}
              </button>
            );
          })}
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

      {active && (() => {
        const siblings = active.batch_id
          ? rows.filter((r) => r.batch_id === active.batch_id)
          : [active];
        return (
        <Modal onClose={() => setActive(null)}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                siblings.length === 1
                  ? "1fr"
                  : `repeat(${Math.min(siblings.length, 2)}, minmax(0, 1fr))`,
              gap: 10,
            }}
          >
            {siblings.map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.id}
                src={s.image_url}
                alt={s.prompt}
                style={{
                  width: "100%",
                  maxHeight: "60vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  background: "var(--surface-2)",
                  cursor: s.id !== active.id ? "pointer" : "default",
                  outline:
                    s.id === active.id
                      ? "2px solid var(--accent)"
                      : "none",
                }}
                onClick={() => s.id !== active.id && setActive(s)}
              />
            ))}
          </div>
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
              References:{" "}
              {active.reference_urls.map((u, i) => (
                <React.Fragment key={u}>
                  {i > 0 && ", "}
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--ink-2)" }}
                  >
                    [{i + 1}]
                  </a>
                </React.Fragment>
              ))}
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
            {siblings.length > 1 && ` · batch of ${siblings.length}`}
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
          </div>
        </Modal>
        );
      })()}
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
