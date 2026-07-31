"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip } from "./ui";
import { Icons } from "./Icons";
import {
  CategoryTag,
  ErrorBanner,
  FilterPill,
  Segmented,
  fam,
  type Family,
} from "./porcelain";
import { Sheet } from "./Sheet";
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

// Single source of truth: adding a text-card style means adding it here (and to
// the --style choices in text-cards/publish-to-dash.py). Everything below —
// the union, the parse allow-list, the counts and the filter row — derives from it.
const KNOWN_STYLES = ["flamingo", "gradient", "sunset", "editorial", "mascot"] as const;

type StyleName = (typeof KNOWN_STYLES)[number] | "unknown";

const STYLE_FAMILY: Record<StyleName, Family> = {
  flamingo: "accent",
  gradient: "info",
  sunset: "attention",
  editorial: "success",
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
  const style = ((KNOWN_STYLES as readonly string[]).includes(m[1])
    ? m[1]
    : "unknown") as StyleName;
  return { style, deck: m[2], date: m[3] ?? null };
}

// Mascot decks are 3:4 slideshow slides; text-card decks are 4:5 carousels.
const aspectOf = (style: StyleName) => (style === "mascot" ? "3 / 4" : "4 / 5");

/**
 * Grid tiles are all 4:5 regardless of the deck's native ratio — mixed heights
 * leave ragged rows and dead space, which is the whole thing this view is
 * fixing. Cropping 3:4 artwork into a 4:5 box trims ~3% off the top and bottom;
 * every style centres its hook well inside that, so no headline is clipped.
 * The lightbox still shows each slide at its true ratio.
 */
const TILE_ASPECT = "4 / 5";
const aspectLabelOf = (style: StyleName) =>
  style === "mascot" ? "1080 × 1446 · 3:4" : "1080 × 1350 · 4:5";

// The only status worth surfacing on a tile — everything else is noise.
const isViral = (d: OurSlideshow) =>
  typeof d.play_count === "number" && d.play_count >= 10_000;

const num = (v: number | null | undefined) =>
  typeof v === "number" ? v.toLocaleString() : "—";

/**
 * Pills and scrims that sit ON TOP of slide artwork can't use surface tokens —
 * the artwork is arbitrary colour. These two literals are the design-specified
 * exception (same pair already used elsewhere in the dash for image overlays).
 */
const OVERLAY_BG = "rgba(29,29,31,0.6)";
const OVERLAY_FG = "#F5F5F7";

const overlayPill: React.CSSProperties = {
  position: "absolute",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  font: "700 9.5px var(--font-ui)",
  letterSpacing: "0.03em",
  background: OVERLAY_BG,
  color: OVERLAY_FG,
  padding: "3px 7px",
  borderRadius: 99,
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  pointerEvents: "none",
};

export function OurSlideshows() {
  const [rows, setRows] = React.useState<OurSlideshow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | StyleName>("all");
  const [sort, setSort] = React.useState<"new" | "views">("new");
  const [openDeck, setOpenDeck] = React.useState<OurSlideshow | null>(null);
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

  const shown = React.useMemo(() => {
    const list =
      filter === "all"
        ? rows
        : rows.filter((r) => parseRef(r.tiktok_url).style === filter);
    // The API already returns created_at desc, so "Newest" is a no-op sort.
    if (sort === "new") return list;
    return [...list].sort(
      (a, b) => (b.play_count ?? -1) - (a.play_count ?? -1),
    );
  }, [rows, filter, sort]);

  const counts = React.useMemo(() => {
    const c = Object.fromEntries(KNOWN_STYLES.map((s) => [s, 0])) as Record<
      (typeof KNOWN_STYLES)[number],
      number
    >;
    for (const r of rows) {
      const s = parseRef(r.tiktok_url).style;
      if (s !== "unknown") c[s] += 1;
    }
    return c;
  }, [rows]);

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(auto-fill, minmax(220px, 1fr))",
    gap: isMobile ? 10 : 14,
    alignItems: "start",
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin / Content"
        title="Our Slideshows"
        subtitle="Text-card and mascot decks we generate in-house. Click a hook to read the whole deck."
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Segmented
              size="sm"
              value={sort}
              onChange={(v) => setSort(v as "new" | "views")}
              options={[
                { value: "new", label: "Newest" },
                { value: "views", label: "Top views" },
              ]}
            />
            <Button variant="secondary" icon={<Icons.Refresh />} onClick={refresh}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* Style filter */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        {(["all", ...KNOWN_STYLES] as const).map((f) => (
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
        <div style={gridStyle}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              style={{
                aspectRatio: TILE_ASPECT,
                borderRadius: 12,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                animation: "dmPulse 1.6s ease-in-out infinite",
              }}
            />
          ))}
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
        <div style={gridStyle}>
          {shown.map((r) => (
            <DeckTile
              key={r.id}
              deck={r}
              isMobile={isMobile}
              onOpen={() => setOpenDeck(r)}
            />
          ))}
        </div>
      )}

      <DeckLightbox
        deck={openDeck}
        isMobile={isMobile}
        onClose={() => setOpenDeck(null)}
      />
    </>
  );
}

function DeckTile({
  deck,
  isMobile,
  onOpen,
}: {
  deck: OurSlideshow;
  isMobile: boolean;
  onOpen: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const { style, deck: name } = parseRef(deck.tiktok_url);
  const cover = deck.slides[0]?.image_url;
  const hasStats = typeof deck.play_count === "number";

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      title={name}
      style={{
        display: "block",
        width: "100%",
        padding: 0,
        border: "none",
        background: "none",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: TILE_ASPECT,
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-xs)",
          transition: "box-shadow 180ms ease",
        }}
      >
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={`Hook slide — ${name}`}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              transform: hover ? "scale(1.03)" : "scale(1)",
              transition: "transform 220ms ease",
            }}
          />
        )}

        <span
          style={{
            ...overlayPill,
            top: 8,
            left: 8,
            textTransform: "capitalize",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: fam(STYLE_FAMILY[style]).solid,
              display: "block",
            }}
          />
          {style}
        </span>

        <span style={{ ...overlayPill, top: 8, right: 8 }}>
          {deck.slide_count}
        </span>

        {isViral(deck) && (
          <span
            style={{
              ...overlayPill,
              bottom: 8,
              left: 8,
              background: "var(--success)",
              color: "var(--on-solid)",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
            }}
          >
            VIRAL
          </span>
        )}

        {/* Stats are secondary: they only surface on hover, over the artwork. */}
        {!isMobile && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              gap: 2,
              padding: 12,
              background:
                "linear-gradient(to top, rgba(29,29,31,0.88), rgba(29,29,31,0.10))",
              color: OVERLAY_FG,
              opacity: hover ? 1 : 0,
              transition: "opacity 160ms ease",
              pointerEvents: "none",
            }}
          >
            <div style={{ font: "500 10.5px var(--font-ui)", opacity: 0.75 }}>
              {formatRelative(deck.created_at)}
            </div>
            {hasStats ? (
              <div
                style={{
                  font: "600 12px var(--font-ui)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.45,
                }}
              >
                <div>{num(deck.play_count)} views</div>
                <div style={{ opacity: 0.85 }}>
                  {num(deck.digg_count)} likes · {num(deck.comment_count)} comments
                </div>
              </div>
            ) : (
              <div style={{ font: "600 12px var(--font-ui)", opacity: 0.9 }}>
                No stats yet
              </div>
            )}
            <div
              style={{
                font: "700 10px var(--font-ui)",
                letterSpacing: "0.04em",
                marginTop: 4,
                opacity: 0.8,
              }}
            >
              OPEN DECK →
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          alignItems: "baseline",
          marginTop: 7,
        }}
      >
        <span
          style={{
            font: "600 12.5px var(--font-ui)",
            color: "var(--ink-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <span
          style={{
            font: "400 11.5px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink-4)",
            whiteSpace: "nowrap",
          }}
        >
          {hasStats ? `${num(deck.play_count)} views` : "—"}
        </span>
      </div>
    </button>
  );
}

function DeckLightbox({
  deck,
  isMobile,
  onClose,
}: {
  deck: OurSlideshow | null;
  isMobile: boolean;
  onClose: () => void;
}) {
  const [i, setI] = React.useState(0);
  const slides = deck?.slides ?? [];
  const n = slides.length;

  // Reset to the hook slide whenever a different deck is opened.
  React.useEffect(() => {
    setI(0);
  }, [deck?.id]);

  React.useEffect(() => {
    if (!deck) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, n - 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck, n]);

  if (!deck) return null;

  const { style, deck: name, date } = parseRef(deck.tiktok_url);
  const aspect = aspectOf(style);
  const current = slides[i]?.image_url;

  const arrow = (dir: -1 | 1): React.CSSProperties => ({
    position: "absolute",
    top: "50%",
    [dir === -1 ? "left" : "right"]: 12,
    transform: "translateY(-50%)",
    width: 36,
    height: 36,
    borderRadius: 99,
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--line)",
    background: "var(--surface)",
    color: "var(--ink)",
    boxShadow: "var(--shadow-sm)",
    cursor: "pointer",
    padding: 0,
  });

  const meta = (
    <div
      style={{
        padding: isMobile ? "14px 16px 20px" : 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        overflowY: isMobile ? undefined : "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            font: "600 20px/1.25 var(--font-display)",
            color: "var(--ink)",
            wordBreak: "break-word",
          }}
        >
          {name}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            flex: "none",
            width: 30,
            height: 30,
            borderRadius: 99,
            display: "grid",
            placeItems: "center",
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink-2)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <Icons.Close size={16} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <CategoryTag family={STYLE_FAMILY[style]}>{style.toUpperCase()}</CategoryTag>
        {date && <Chip title="Generated">{date}</Chip>}
        <Chip title="Aspect ratio">{aspectLabelOf(style)}</Chip>
        <Chip title="Slides">
          {deck.slide_count} slide{deck.slide_count === 1 ? "" : "s"}
        </Chip>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
          padding: "12px 14px",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 12,
        }}
      >
        {(
          [
            ["Views", deck.play_count],
            ["Likes", deck.digg_count],
            ["Comments", deck.comment_count],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <div
              style={{
                font: "650 9.5px var(--font-ui)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                marginBottom: 3,
              }}
            >
              {label}
            </div>
            <div
              style={{
                font: "650 16px var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
                color: typeof v === "number" ? "var(--ink)" : "var(--ink-4)",
              }}
            >
              {num(v)}
            </div>
          </div>
        ))}
      </div>

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
          gap: 14,
          flexWrap: "wrap",
          marginTop: "auto",
          paddingTop: 4,
        }}
      >
        {current && (
          <a
            href={current}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              font: "600 12.5px var(--font-ui)",
              color: "var(--link)",
              textDecoration: "none",
            }}
          >
            Open full-size PNG ↗
          </a>
        )}
        {deck.public_url && (
          <a
            href={deck.public_url}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              font: "600 12.5px var(--font-ui)",
              color: "var(--link)",
              textDecoration: "none",
            }}
          >
            Live on TikTok ↗
          </a>
        )}
      </div>
    </div>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      padded={false}
      fullscreenOnMobile
      desktopMaxWidth={1040}
      ariaLabel={name}
    >
      {isMobile ? (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div
            onScroll={(e) => {
              const el = e.currentTarget;
              const w = el.clientWidth || 1;
              setI(Math.round(el.scrollLeft / w));
            }}
            style={{
              display: "flex",
              overflowX: "auto",
              scrollSnapType: "x mandatory",
              background: "var(--bg-2)",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {slides.map((s, idx) => (
              <div
                key={idx}
                style={{
                  flex: "0 0 100%",
                  scrollSnapAlign: "start",
                  aspectRatio: aspect,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.image_url}
                  alt={`Slide ${idx + 1}`}
                  decoding="async"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </div>
            ))}
          </div>
          <div
            style={{
              textAlign: "center",
              padding: "8px 0 2px",
              font: "650 11px var(--font-ui)",
              color: "var(--ink-3)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {i + 1} / {n}
          </div>
          {meta}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            minHeight: 0,
          }}
        >
          <div
            style={{
              position: "relative",
              background: "var(--bg-2)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "18px 18px 12px",
              borderRight: "1px solid var(--line)",
              minWidth: 0,
            }}
          >
            {current && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current}
                alt={`Slide ${i + 1} of ${n}`}
                decoding="async"
                style={{
                  maxWidth: "100%",
                  maxHeight: "72vh",
                  aspectRatio: aspect,
                  objectFit: "contain",
                  borderRadius: 10,
                  display: "block",
                }}
              />
            )}

            {i > 0 && (
              <button
                type="button"
                aria-label="Previous slide"
                onClick={() => setI((v) => Math.max(v - 1, 0))}
                style={arrow(-1)}
              >
                <Icons.ChevronLeft size={18} />
              </button>
            )}
            {i < n - 1 && (
              <button
                type="button"
                aria-label="Next slide"
                onClick={() => setI((v) => Math.min(v + 1, n - 1))}
                style={arrow(1)}
              >
                <Icons.ChevronRight size={18} />
              </button>
            )}

            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                marginTop: 12,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {slides.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Go to slide ${idx + 1}`}
                  onClick={() => setI(idx)}
                  style={{
                    width: idx === i ? 18 : 7,
                    height: 7,
                    borderRadius: 99,
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    background: idx === i ? "var(--ink)" : "var(--line-2)",
                    transition: "width 160ms ease, background 160ms ease",
                  }}
                />
              ))}
              <span
                style={{
                  marginLeft: 8,
                  font: "650 11px var(--font-ui)",
                  color: "var(--ink-3)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {i + 1} / {n}
              </span>
            </div>

            {/* Warm the neighbours so arrowing through is instant. */}
            <div style={{ display: "none" }} aria-hidden>
              {[i - 1, i + 1]
                .filter((k) => k >= 0 && k < n)
                .map((k) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={k} src={slides[k].image_url} alt="" />
                ))}
            </div>
          </div>

          {meta}
        </div>
      )}
    </Sheet>
  );
}
