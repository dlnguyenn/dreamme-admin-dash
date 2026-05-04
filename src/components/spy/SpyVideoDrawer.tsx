"use client";

import * as React from "react";
import { Icons } from "../Icons";
import { Button, Chip } from "../ui";
import { SideDrawer } from "../SideDrawer";
import { useIsMobile } from "@/lib/useIsMobile";
import type { SpyVideoRow } from "./SpyTypes";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (isNaN(ts)) return "—";
  const hours = Math.round((Date.now() - ts) / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

export function SpyVideoDrawer({
  open,
  video,
  saved,
  onClose,
  onToggleSave,
}: {
  open: boolean;
  video: SpyVideoRow | null;
  saved: boolean;
  onClose: () => void;
  onToggleSave: () => void;
}) {
  const isMobile = useIsMobile();
  const [whyLoading, setWhyLoading] = React.useState(false);
  const [whyError, setWhyError] = React.useState<string | null>(null);
  const [why, setWhy] = React.useState<string | null>(video?.why_it_hit ?? null);

  React.useEffect(() => {
    setWhy(video?.why_it_hit ?? null);
    setWhyError(null);
  }, [video?.id, video?.why_it_hit]);

  const explainWhy = async () => {
    if (!video) return;
    setWhyLoading(true);
    setWhyError(null);
    try {
      const res = await fetch(`/api/spy/why/${video.id}`, { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; whyItHit?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "failed");
      setWhy(json.whyItHit ?? null);
    } catch (e) {
      setWhyError((e as Error).message);
    } finally {
      setWhyLoading(false);
    }
  };

  if (!video) return null;

  const padX = isMobile ? 16 : 24;
  const padY = isMobile ? 14 : 20;

  return (
    <SideDrawer open={open} onClose={onClose} ariaLabel="Spy video detail" desktopWidth={720}>
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: `${padY}px ${padX}px`,
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            {video.source_type === "search" ? "q:" : "#"}
            {video.source_hashtag} · {relative(video.posted_at)}
          </div>
          <div
            className="serif"
            style={{
              fontSize: isMobile ? 18 : 22,
              fontStyle: "italic",
              lineHeight: 1.25,
            }}
          >
            {video.first_slide_text || "(no hook text)"}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.Close size={16} />}
          onClick={onClose}
          aria-label="Close"
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: `16px ${padX}px ${padY + 16}px`,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Thumbnail + key actions */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 240px) 1fr",
            gap: 16,
          }}
        >
          {video.first_slide_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.first_slide_url}
              alt={video.first_slide_text ?? "first slide"}
              style={{
                width: "100%",
                aspectRatio: "9 / 16",
                maxHeight: isMobile ? 360 : "none",
                objectFit: "cover",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--surface-2)",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "9 / 16",
                background: "var(--surface-2)",
                border: "1px dashed var(--line-2)",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-4)",
                fontSize: 12,
              }}
            >
              no first slide
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Stats video={video} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                href={video.post_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 12px",
                  background: "var(--ink)",
                  color: "var(--surface)",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 8,
                  textDecoration: "none",
                }}
              >
                Open on TikTok
                <span style={{ fontSize: 10 }}>↗</span>
              </a>
              <Button
                variant={saved ? "secondary" : "ghost"}
                size="sm"
                icon={
                  saved ? <Icons.BookmarkFilled size={14} /> : <Icons.Bookmark size={14} />
                }
                onClick={onToggleSave}
              >
                {saved ? "Saved" : "Save"}
              </Button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {video.is_viral && (
                <Chip tone="accent" style={{ fontSize: 10 }}>
                  viral
                </Chip>
              )}
              {video.category && (
                <Chip tone="neutral" style={{ fontSize: 10 }}>
                  {video.category}
                </Chip>
              )}
              {video.slide_count != null && (
                <Chip tone="neutral" style={{ fontSize: 10 }}>
                  {video.slide_count === 0
                    ? "video"
                    : video.slide_count === 1
                      ? "single slide"
                      : `${video.slide_count}-slide`}
                </Chip>
              )}
              {video.author_handle && (
                <Chip tone="neutral" style={{ fontSize: 10 }}>
                  @{video.author_handle}
                </Chip>
              )}
            </div>
          </div>
        </div>

        {/* Why this hit */}
        <div
          style={{
            padding: 16,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 12,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Why this hit (Haiku)
          </div>
          {why ? (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--ink-2)" }}>
              {why}
            </p>
          ) : whyLoading ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-4)" }}>
              Asking Haiku…
            </p>
          ) : whyError ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--accent)" }}>
              {whyError}{" "}
              <button
                onClick={explainWhy}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--ink-2)",
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                retry
              </button>
            </p>
          ) : (
            <Button variant="secondary" size="sm" onClick={explainWhy}>
              Explain why this hit
            </Button>
          )}
        </div>

        {/* Caption */}
        {video.caption && (
          <div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              Caption
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
              }}
            >
              {video.caption}
            </p>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}

function Stats({ video }: { video: SpyVideoRow }) {
  const cells: Array<{ label: string; value: string; title?: string }> = [
    { label: "Views", value: fmt(video.view_count) },
    { label: "Likes", value: fmt(video.like_count) },
    { label: "Comments", value: fmt(video.comment_count) },
    { label: "Shares", value: fmt(video.share_count) },
  ];
  if (video.outlier_score != null) {
    cells.push({
      label: "Outlier",
      value: `${video.outlier_score.toFixed(1)}×`,
      title: `Views ÷ author baseline median${
        video.author_baseline_median != null
          ? ` (${fmt(video.author_baseline_median)} median across ${video.author_baseline_count ?? "?"} posts)`
          : ""
      }`,
    });
  }
  if (video.views_per_hour != null) {
    cells.push({
      label: "Velocity",
      value: `${fmt(Math.round(video.views_per_hour))}/hr`,
      title: "Average views per hour since posted",
    });
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 8,
      }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          title={c.title}
          style={{
            padding: "10px 12px",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 9,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 2,
            }}
          >
            {c.label}
          </div>
          <div className="serif" style={{ fontSize: 18, color: "var(--ink)", fontWeight: 400 }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
