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
  const [generating, setGenerating] = React.useState(false);
  const [latest, setLatest] = React.useState<ImageGenerationRow | null>(null);

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
          referenceImageUrl: trimmedRef || undefined,
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
      const r = json.result as {
        id: string;
        imageUrl: string;
        prompt: string;
        aspectRatio: string | null;
        geminiModel: string;
        createdAt: string;
        referenceImageUrl: string | null;
      };
      const row: ImageGenerationRow = {
        id: r.id,
        prompt: r.prompt,
        aspect_ratio: r.aspectRatio,
        image_url: r.imageUrl,
        gemini_model: r.geminiModel,
        source: "dashboard",
        created_at: r.createdAt,
        reference_urls: r.referenceImageUrl ? [r.referenceImageUrl] : null,
      };
      setLatest(row);
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
                Reference image URL (optional — image-to-image)
              </div>
              <input
                type="url"
                placeholder="https://example.com/image.jpg"
                value={refUrl}
                onChange={(e) => setRefUrl(e.target.value)}
                style={inputStyle}
              />
            </div>
          </Section>

          <Section title="2. Latest">
            <div
              style={{
                aspectRatio: aspectRatioToCss(latest?.aspect_ratio ?? aspectRatio),
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
              {latest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={latest.image_url}
                  alt={latest.prompt}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <span style={{ fontSize: 12, color: "var(--ink-4)" }}>—</span>
              )}
            </div>
            {latest && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 10,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icons.Copy />}
                  onClick={() => copy(latest.image_url, "Image URL copied")}
                >
                  Copy URL
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(latest.image_url, "_blank", "noopener")}
                >
                  Open full-res
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRefUrl(latest.image_url)}
                  title="Use this image as the reference for the next generation"
                >
                  Edit this image
                </Button>
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
