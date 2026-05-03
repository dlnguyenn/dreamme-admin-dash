"use client";

import * as React from "react";
import { Chip } from "../ui";
import { Icons } from "../Icons";
import type { SpyVideoRow } from "./SpyTypes";

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatRelative(iso: string | null): string {
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

export function SpyVideoCard({
  video,
  saved,
  onClick,
  onToggleSave,
}: {
  video: SpyVideoRow;
  saved: boolean;
  onClick: () => void;
  onToggleSave: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        background: "var(--surface)",
        border: `1px solid ${hover ? "var(--ink-4)" : "var(--line-2)"}`,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease",
        boxShadow: hover ? "var(--shadow-sm)" : "none",
        transform: hover ? "translateY(-1px)" : "none",
        minWidth: 0,
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: "relative",
          aspectRatio: "9 / 16",
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        {video.first_slide_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.first_slide_url}
            alt={video.first_slide_text ?? "spy thumbnail"}
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-4)",
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            no slide
          </div>
        )}
        {/* Viral badge */}
        {video.is_viral && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "3px 7px",
              background: "color-mix(in oklab, var(--accent) 18%, var(--surface))",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              fontSize: 9,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            viral
          </div>
        )}
        {/* View count */}
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            padding: "3px 7px",
            background: "color-mix(in oklab, var(--ink) 75%, transparent)",
            backdropFilter: "blur(4px)",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            color: "white",
            fontWeight: 600,
          }}
        >
          {formatViewCount(video.view_count)}
        </div>
        {/* Save button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSave();
          }}
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            width: 30,
            height: 30,
            border: "none",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--ink) 75%, transparent)",
            backdropFilter: "blur(4px)",
            color: "white",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title={saved ? "Remove from favorites" : "Save to favorites"}
        >
          {saved ? <Icons.BookmarkFilled size={14} /> : <Icons.Bookmark size={14} />}
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          className="serif"
          style={{
            fontSize: 14,
            lineHeight: 1.35,
            color: "var(--ink)",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {video.first_slide_text || (
            <span style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
              (no hook text)
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            fontSize: 10,
            fontFamily: "var(--font-geist-mono), monospace",
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <span>
            {video.source_type === "search" ? "q:" : "#"}
            {video.source_hashtag}
          </span>
          <span>·</span>
          <span>{formatRelative(video.posted_at)}</span>
          {video.author_handle && (
            <>
              <span>·</span>
              <span style={{ textTransform: "lowercase", letterSpacing: 0 }}>
                @{video.author_handle}
              </span>
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
          onClick={stop}
        >
          {video.category && (
            <Chip tone="neutral" style={{ fontSize: 10 }}>
              {video.category}
            </Chip>
          )}
          {video.slide_count != null && video.slide_count > 1 && (
            <Chip tone="neutral" style={{ fontSize: 10 }}>
              {video.slide_count}-slide
            </Chip>
          )}
        </div>
      </div>
    </div>
  );
}
