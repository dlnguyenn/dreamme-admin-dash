"use client";

import * as React from "react";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
import { formatRelative } from "@/lib/format";
import { useIsMobile } from "@/lib/useIsMobile";

interface Slide {
  image_url: string;
}

interface ViralSlideshow {
  id: string;
  tiktok_url: string;
  author_username: string | null;
  caption: string | null;
  play_count: number | null;
  digg_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  post_created_at: string | null;
  slide_count: number;
  slides: Slide[];
  created_at: string;
}

function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

export function ViralSlideshows() {
  const toast = useToast();
  const [rows, setRows] = React.useState<ViralSlideshow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [collecting, setCollecting] = React.useState(false);
  const [collectMsg, setCollectMsg] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/viral-slideshows", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.slideshows as ViralSlideshow[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const collect = async () => {
    const trimmed = url.trim();
    if (!trimmed || collecting) return;
    setCollecting(true);
    setCollectMsg(null);
    try {
      const res = await fetch("/api/viral-slideshows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokUrl: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      const slideshow = data.slideshow as ViralSlideshow;
      setRows((prev) => [slideshow, ...prev.filter((r) => r.id !== slideshow.id)]);
      setUrl("");
      toast(`Collected ${slideshow.slide_count} slides`);
    } catch (e) {
      setCollectMsg((e as Error).message);
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div
          className="serif"
          style={{ fontSize: 26, fontStyle: "italic", color: "var(--ink)" }}
        >
          Viral Slideshows
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
          Paste a TikTok slideshow (photo) URL. Every slide image is downloaded
          into our library so you can study viral posts slide-by-slide, even
          after the original expires.
        </div>
      </div>

      {/* Collect bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          border: "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--surface)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !collecting) {
                e.preventDefault();
                void collect();
              }
            }}
            placeholder="https://www.tiktok.com/@creator/photo/..."
            disabled={collecting}
            style={{
              flex: "1 1 320px",
              minWidth: 0,
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--surface-2)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <Button
            variant="primary"
            icon={<Icons.Download />}
            onClick={collect}
            disabled={collecting || !url.trim()}
          >
            {collecting ? "Collecting…" : "Collect"}
          </Button>
        </div>
        {collecting && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Scraping slides… this can take 5–15 seconds.
          </div>
        )}
        {collectMsg && (
          <div
            style={{
              padding: "8px 12px",
              fontSize: 12.5,
              color: "var(--accent)",
              background:
                "color-mix(in oklab, var(--accent) 10%, var(--surface))",
              border:
                "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
              borderRadius: 10,
            }}
          >
            {collectMsg}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background:
              "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--ink-3)" }}>
          <div className="serif" style={{ fontSize: 20, fontStyle: "italic" }}>
            Loading collection…
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line)",
            borderRadius: 14,
            color: "var(--ink-3)",
          }}
        >
          <div
            className="serif"
            style={{ fontSize: 22, fontStyle: "italic", marginBottom: 6 }}
          >
            No slideshows yet
          </div>
          <div style={{ fontSize: 13 }}>
            Paste a TikTok slideshow URL above to start your collection.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rows.map((r) => (
            <SlideshowCard key={r.id} slideshow={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlideshowCard({ slideshow }: { slideshow: ViralSlideshow }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const author = slideshow.author_username
    ? `@${slideshow.author_username}`
    : "TikTok creator";
  const cover = slideshow.slides[0]?.image_url;

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "72px 1fr" : "88px 1fr auto",
          gap: isMobile ? 12 : 16,
          alignItems: "center",
          padding: isMobile ? 12 : 14,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: isMobile ? 72 : 88,
            aspectRatio: "9 / 16",
            borderRadius: 10,
            overflow: "hidden",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
          }}
        >
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt="Cover slide"
              loading="lazy"
              decoding="async"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
        </div>

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ink-4)",
            }}
          >
            {author} · {slideshow.slide_count} slide
            {slideshow.slide_count === 1 ? "" : "s"}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip title="Plays">▶ {compact(slideshow.play_count)}</Chip>
            <Chip title="Likes">♥ {compact(slideshow.digg_count)}</Chip>
            <Chip title="Comments">💬 {compact(slideshow.comment_count)}</Chip>
            <Chip title="Shares">↗ {compact(slideshow.share_count)}</Chip>
          </div>

          {slideshow.caption && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-3)",
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: open ? undefined : 2,
                WebkitBoxOrient: "vertical",
                overflow: open ? "visible" : "hidden",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {slideshow.caption}
            </div>
          )}
        </div>

        {!isMobile && (
          <div
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              fontFamily: "var(--font-geist-mono), monospace",
              textAlign: "right",
              alignSelf: "flex-start",
            }}
          >
            {slideshow.post_created_at
              ? formatRelative(slideshow.post_created_at)
              : `saved ${formatRelative(slideshow.created_at)}`}
          </div>
        )}
      </div>

      {/* Expanded: all slides + link */}
      {open && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: isMobile ? 12 : 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              overflowX: "auto",
              overflowY: "hidden",
              scrollSnapType: "x mandatory",
              paddingBottom: 6,
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", gap: 12, minWidth: "min-content" }}>
              {slideshow.slides.map((slide, i) => (
                <a
                  key={i}
                  href={slide.image_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{
                    flex: "0 0 auto",
                    width: isMobile ? 150 : 190,
                    scrollSnapAlign: "start",
                    position: "relative",
                    aspectRatio: "9 / 16",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    display: "block",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slide.image_url}
                    alt={`Slide ${i + 1}`}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      fontSize: 10,
                      fontFamily: "var(--font-geist-mono), monospace",
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: "rgba(0,0,0,0.55)",
                      color: "white",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {i + 1}
                  </div>
                </a>
              ))}
            </div>
          </div>

          <a
            href={slideshow.tiktok_url}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-2)",
              textDecoration: "none",
              padding: "6px 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface-2)",
              alignSelf: "flex-start",
            }}
          >
            <Icons.Link size={13} />
            Open on TikTok
          </a>
        </div>
      )}
    </div>
  );
}
