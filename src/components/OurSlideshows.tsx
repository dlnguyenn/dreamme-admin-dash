"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip } from "./ui";
import { Icons } from "./Icons";
import { ErrorBanner, FilterPill, type Family } from "./porcelain";
import { formatRelative } from "@/lib/format";
import { useIsMobile } from "@/lib/useIsMobile";

interface Slide {
  image_url: string;
}

interface OurSlideshow {
  id: string;
  platform?: string;
  tiktok_url: string;
  public_url?: string | null;
  author_username: string | null;
  caption: string | null;
  post_created_at: string | null;
  slide_count: number;
  slides: Slide[];
  created_at: string;
  play_count?: number | null;
  digg_count?: number | null;
  comment_count?: number | null;
  share_count?: number | null;
}

type StyleName = "flamingo" | "gradient" | "mascot" | "unknown";

const STYLE_FAMILY: Record<StyleName, Family> = {
  flamingo: "accent",
  gradient: "info",
  mascot: "warning",
  unknown: "neutral",
};

/**
 * Rows are written by text-cards/publish-to-dash.py with a synthetic URL of
 * `generated://<style>/<deck-name>/<YYYY-MM-DD>` — parse it back out for the
 * badge + title rather than storing those as extra columns.
 */
function parseRef(url: string): { style: StyleName; deck: string; date: string | null } {
  const m = /^generated:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?/.exec(url ?? "");
  if (!m) return { style: "unknown", deck: url ?? "deck", date: null };
  const style = (
    m[1] === "flamingo" || m[1] === "gradient" || m[1] === "mascot" ? m[1] : "unknown"
  ) as StyleName;
  return { style, deck: m[2], date: m[3] ?? null };
}

// Map posting state + view velocity onto the design's status ladder.
function deckStatus(d: OurSlideshow): {
  label: string;
  bg: string;
  fg: string;
} {
  if (typeof d.play_count !== "number") {
    return {
      label: "NEW",
      bg: "var(--neutral-soft)",
      fg: "var(--neutral-text)",
    };
  }
  if (d.play_count >= 10_000) {
    return { label: "VIRAL", bg: "var(--success)", fg: "var(--on-solid)" };
  }
  return {
    label: "STEADY",
    bg: "var(--neutral-soft)",
    fg: "var(--neutral-text)",
  };
}

const headerCell = (align: "left" | "right" = "right"): React.CSSProperties => ({
  font: "650 10.5px var(--font-ui)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  textAlign: align,
  whiteSpace: "nowrap",
});

export function OurSlideshows() {
  const [rows, setRows] = React.useState<OurSlideshow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | StyleName>("all");
  const isMobile = useIsMobile();

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
    const c = { flamingo: 0, gradient: 0, mascot: 0 };
    for (const r of rows) {
      const s = parseRef(r.tiktok_url).style;
      if (s === "flamingo" || s === "gradient" || s === "mascot") c[s] += 1;
    }
    return c;
  }, [rows]);

  const grid = isMobile
    ? "minmax(0, 1fr) 76px 84px"
    : "minmax(0, 1fr) 90px 80px 90px 96px";

  return (
    <>
      <PageHeader
        eyebrow="Admin / Content"
        title="Our Slideshows"
        subtitle="Slideshows we generate in-house. The daily jobs post one flamingo and one gradient text-card deck plus the coral-mascot GLP-1 slideshow (auto-queued to @dreammeglp1app) here, with live TikTok stats once posted."
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {/* Style filter */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        {(["all", "flamingo", "gradient", "mascot"] as const).map((f) => (
          <FilterPill
            key={f}
            label={f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            count={f === "all" ? rows.length : counts[f]}
            selected={filter === f}
            countFamily={f === "all" ? undefined : STYLE_FAMILY[f]}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "var(--ink-3)",
            font: "400 14px var(--font-ui)",
          }}
        >
          Loading decks…
        </div>
      ) : shown.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
            color: "var(--ink-3)",
          }}
        >
          <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>
            No decks yet
          </div>
          <div style={{ font: "400 13px var(--font-ui)" }}>
            The daily 5am job posts new decks here automatically.
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: grid,
              gap: 12,
              alignItems: "center",
              padding: "10px 16px",
            }}
          >
            <span style={headerCell("left")}>Deck</span>
            <span style={headerCell()}>Views</span>
            {!isMobile && <span style={headerCell()}>Likes</span>}
            {!isMobile && <span style={headerCell()}>Comments</span>}
            <span style={{ ...headerCell(), textAlign: "right" }}>Status</span>
          </div>

          {shown.map((r) => (
            <DeckRow key={r.id} deck={r} grid={grid} isMobile={isMobile} />
          ))}
        </div>
      )}
    </>
  );
}

function DeckRow({
  deck,
  grid,
  isMobile,
}: {
  deck: OurSlideshow;
  grid: string;
  isMobile: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const { style, deck: name, date } = parseRef(deck.tiktok_url);
  const cover = deck.slides[0]?.image_url;
  const status = deckStatus(deck);
  // Mascot decks are 3:4 slideshow slides; text-card decks are 4:5 carousels.
  const aspect = style === "mascot" ? "3 / 4" : "4 / 5";
  const aspectLabel = style === "mascot" ? "1080 × 1446 · 3:4" : "1080 × 1350 · 4:5";

  const numCell = (
    v: number | null | undefined,
    strong?: boolean,
  ): React.ReactNode => (
    <span
      style={{
        font: strong
          ? "650 13.5px var(--font-ui)"
          : "400 13px var(--font-ui)",
        fontVariantNumeric: "tabular-nums",
        color:
          typeof v === "number"
            ? strong
              ? "var(--ink)"
              : "var(--ink-2)"
            : "var(--ink-4)",
        textAlign: "right",
      }}
    >
      {typeof v === "number" ? v.toLocaleString() : "—"}
    </span>
  );

  return (
    <>
      <div
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "grid",
          gridTemplateColumns: grid,
          gap: 12,
          alignItems: "center",
          padding: "10px 16px",
          borderTop: "1px solid var(--line)",
          background: hover ? "var(--surface-2)" : "transparent",
          cursor: "pointer",
          transition: "background 120ms ease",
        }}
      >
        {/* Thumb + title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 40,
              height: 52,
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--surface-2)",
              position: "relative",
              flex: "none",
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
            {/* Design-specified overlay literal (pill on image thumbs) */}
            <span
              style={{
                position: "absolute",
                bottom: 3,
                right: 3,
                font: "700 9px var(--font-ui)",
                background: "rgba(29,29,31,0.6)",
                color: "#F5F5F7",
                padding: "1px 5px",
                borderRadius: 99,
              }}
            >
              {deck.slide_count}
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                font: "600 13.5px var(--font-ui)",
                color: "var(--ink)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {name}
            </div>
            <div
              style={{
                font: "400 11.5px var(--font-ui)",
                color: "var(--ink-4)",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {style} · {deck.slide_count} slide
              {deck.slide_count === 1 ? "" : "s"} ·{" "}
              {formatRelative(deck.created_at)}
            </div>
          </div>
        </div>

        {numCell(deck.play_count, true)}
        {!isMobile && numCell(deck.digg_count)}
        {!isMobile && numCell(deck.comment_count)}

        <span
          style={{
            justifySelf: "end",
            font: "700 10px var(--font-ui)",
            letterSpacing: "0.04em",
            padding: "3px 9px",
            borderRadius: 99,
            background: status.bg,
            color: status.fg,
            whiteSpace: "nowrap",
          }}
        >
          {status.label}
        </span>
      </div>

      {open && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            background: "var(--surface-2)",
            padding: isMobile ? 12 : "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {deck.caption && (
            <div
              style={{
                font: "400 13px/1.5 var(--font-ui)",
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {deck.caption}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Chip title="Aspect ratio">{aspectLabel}</Chip>
            {date && <Chip title="Generated">{date}</Chip>}
            {typeof deck.play_count === "number" && (
              <Chip tone="success" title="TikTok stats">
                {deck.play_count.toLocaleString()} views ·{" "}
                {(deck.digg_count ?? 0).toLocaleString()} likes ·{" "}
                {(deck.comment_count ?? 0).toLocaleString()} comments
              </Chip>
            )}
            {deck.public_url && (
              <a
                href={deck.public_url}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                style={{
                  font: "600 12px var(--font-ui)",
                  color: "var(--link)",
                  textDecoration: "none",
                }}
              >
                Live on TikTok ↗
              </a>
            )}
          </div>

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
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: "0 0 auto",
                    width: isMobile ? 150 : 190,
                    scrollSnapAlign: "start",
                    position: "relative",
                    aspectRatio: aspect,
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--surface)",
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
                  {/* Design-specified overlay literal (pill on image thumbs) */}
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      font: "700 10px var(--font-ui)",
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: "rgba(29,29,31,0.65)",
                      color: "#F5F5F7",
                    }}
                  >
                    {i + 1}
                  </div>
                </a>
              ))}
            </div>
          </div>

          <div style={{ font: "400 11.5px var(--font-ui)", color: "var(--ink-4)" }}>
            Click any slide to open the full-size PNG, then save it to post.
          </div>
        </div>
      )}
    </>
  );
}
