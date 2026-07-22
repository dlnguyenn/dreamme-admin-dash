"use client";

import * as React from "react";
import { Chip } from "./ui";
import { Icons } from "./Icons";
import { formatRelative } from "@/lib/format";
import { useIsMobile } from "@/lib/useIsMobile";

interface Slide {
  image_url: string;
}

interface OurSlideshow {
  id: string;
  platform?: string;
  tiktok_url: string;
  author_username: string | null;
  caption: string | null;
  post_created_at: string | null;
  slide_count: number;
  slides: Slide[];
  created_at: string;
}

type StyleName = "flamingo" | "gradient" | "unknown";

const STYLE_COLOR: Record<StyleName, string> = {
  flamingo: "#D84668",
  gradient: "#F43678",
  unknown: "var(--ink-3)",
};

/**
 * Rows are written by text-cards/publish-to-dash.py with a synthetic URL of
 * `generated://<style>/<deck-name>/<YYYY-MM-DD>` — parse it back out for the
 * badge + title rather than storing those as extra columns.
 */
function parseRef(url: string): { style: StyleName; deck: string; date: string | null } {
  const m = /^generated:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?/.exec(url ?? "");
  if (!m) return { style: "unknown", deck: url ?? "deck", date: null };
  const style = (m[1] === "flamingo" || m[1] === "gradient" ? m[1] : "unknown") as StyleName;
  return { style, deck: m[2], date: m[3] ?? null };
}

export function OurSlideshows() {
  const [rows, setRows] = React.useState<OurSlideshow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | StyleName>("all");

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/viral-slideshows?source=generated", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.slideshows as OurSlideshow[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const shown =
    filter === "all"
      ? rows
      : rows.filter((r) => parseRef(r.tiktok_url).style === filter);

  const counts = React.useMemo(() => {
    const c = { flamingo: 0, gradient: 0 };
    for (const r of rows) {
      const s = parseRef(r.tiktok_url).style;
      if (s === "flamingo" || s === "gradient") c[s] += 1;
    }
    return c;
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div
          className="serif"
          style={{ fontSize: 26, fontStyle: "italic", color: "var(--ink)" }}
        >
          Our Slideshows
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
          Text-card carousels we generate in-house. The 5am job produces one
          flamingo and one gradient deck each day and posts them here, ready to
          download and publish.
        </div>
      </div>

      {/* Style filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(["all", "flamingo", "gradient"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 8,
              cursor: "pointer",
              textTransform: "capitalize",
              border: "1px solid var(--line)",
              background: filter === f ? "var(--ink)" : "var(--surface-2)",
              color: filter === f ? "var(--surface)" : "var(--ink-2)",
            }}
          >
            {f}
            {f === "all"
              ? ` · ${rows.length}`
              : ` · ${counts[f as "flamingo" | "gradient"]}`}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--ink-3)" }}>
          <div className="serif" style={{ fontSize: 20, fontStyle: "italic" }}>
            Loading decks…
          </div>
        </div>
      ) : shown.length === 0 ? (
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
            No decks yet
          </div>
          <div style={{ fontSize: 13 }}>
            The daily 5am job posts new decks here automatically.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {shown.map((r) => (
            <DeckCard key={r.id} deck={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckCard({ deck }: { deck: OurSlideshow }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const { style, deck: name, date } = parseRef(deck.tiktok_url);
  const cover = deck.slides[0]?.image_url;

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
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "84px 1fr" : "104px 1fr auto",
          gap: isMobile ? 12 : 16,
          alignItems: "center",
          padding: isMobile ? 12 : 14,
          cursor: "pointer",
        }}
      >
        {/* 4:5 cover — our decks are portrait carousels, not 9:16 video */}
        <div
          style={{
            width: isMobile ? 84 : 104,
            aspectRatio: "4 / 5",
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
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                padding: "1px 7px",
                borderRadius: 5,
                fontSize: 9.5,
                color: "#fff",
                background: STYLE_COLOR[style],
              }}
            >
              {style}
            </span>
            {name} · {deck.slide_count} slide{deck.slide_count === 1 ? "" : "s"}
          </div>

          {deck.caption && (
            <div
              style={{
                fontSize: 13.5,
                color: "var(--ink)",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: open ? undefined : 2,
                WebkitBoxOrient: "vertical",
                overflow: open ? "visible" : "hidden",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {deck.caption}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip title="Aspect ratio">1080 × 1350 · 4:5</Chip>
            {date && <Chip title="Generated">{date}</Chip>}
          </div>
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
            {formatRelative(deck.created_at)}
          </div>
        )}
      </div>

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
              {deck.slides.map((slide, i) => (
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
                    aspectRatio: "4 / 5",
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
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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

          <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
            Click any slide to open the full-size PNG, then save it to post.
          </div>
        </div>
      )}
    </div>
  );
}
