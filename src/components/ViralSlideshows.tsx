"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
import { ErrorBanner, FilterPill, SourceTag } from "./porcelain";
import { formatRelative } from "@/lib/format";
import { useIsMobile } from "@/lib/useIsMobile";

interface Slide {
  image_url: string;
}

interface Comment {
  text: string;
  likes: number;
  username: string | null;
  created: string | null;
  pinned: boolean;
  reply_count: number;
}

interface ViralSlideshow {
  id: string;
  platform?: string;
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
  comments: Comment[];
  created_at: string;
}

function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

type Mode = "url" | "profile";
type Platform = "tiktok" | "instagram";

export function ViralSlideshows() {
  const toast = useToast();
  const [rows, setRows] = React.useState<ViralSlideshow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>("url");
  const [platform, setPlatform] = React.useState<Platform>("tiktok");
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [busyMsg, setBusyMsg] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/viral-slideshows?source=collected", {
        cache: "no-store",
      });
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

  const patchRow = React.useCallback((updated: ViralSlideshow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setBusyMsg(null);
    try {
      if (mode === "url") {
        const res = await fetch("/api/viral-slideshows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        const s = data.slideshow as ViralSlideshow;
        setRows((prev) => [s, ...prev.filter((r) => r.id !== s.id)]);
        setInput("");
        toast(`Collected ${s.slide_count} slides · ${s.comments?.length ?? 0} comments`);
      } else {
        const res = await fetch("/api/viral-slideshows/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: trimmed, platform }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        const added = (data.slideshows as ViralSlideshow[]) ?? [];
        if (added.length > 0) {
          const ids = new Set(added.map((s) => s.id));
          setRows((prev) => [...added, ...prev.filter((r) => !ids.has(r.id))]);
        }
        setInput("");
        const noun = platform === "instagram" ? "carousel" : "slideshow";
        toast(
          `@${data.profile}: saved ${data.saved} ${noun}${data.saved === 1 ? "" : "s"}` +
            (data.skipped ? ` · ${data.skipped} skipped` : ""),
        );
      }
    } catch (e) {
      setBusyMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const placeholder =
    platform === "instagram"
      ? mode === "url"
        ? "https://www.instagram.com/p/..."
        : "@creator  or  https://www.instagram.com/creator"
      : mode === "url"
        ? "https://www.tiktok.com/@creator/photo/..."
        : "@creator  or  https://www.tiktok.com/@creator";

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Content"
        title="Viral Slideshows"
        subtitle="Collect TikTok slideshows & Instagram carousels for analysis. Paste a single post URL, or pull a creator's top 10. Every image and the top 20 comments are downloaded into our library."
      />

      {/* Collect bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "16px 18px",
          border: "1px solid var(--line)",
          borderRadius: 16,
          background: "var(--surface)",
          boxShadow: "var(--shadow-card)",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {/* Platform filter */}
          <div style={{ display: "flex", gap: 8 }}>
            {(["tiktok", "instagram"] as Platform[]).map((p) => (
              <FilterPill
                key={p}
                label={p === "tiktok" ? "TikTok" : "Instagram"}
                selected={platform === p}
                onClick={() => !busy && setPlatform(p)}
              />
            ))}
          </div>

          {/* Mode filter */}
          <div style={{ display: "flex", gap: 8 }}>
            {(["url", "profile"] as Mode[]).map((m) => (
              <FilterPill
                key={m}
                label={m === "url" ? "Single URL" : "Profile · top 10"}
                selected={mode === m}
                onClick={() => !busy && setMode(m)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            disabled={busy}
            style={{
              flex: "1 1 320px",
              minWidth: 0,
              padding: "10px 12px",
              font: "400 13px var(--font-ui)",
              border: "1px solid var(--line-2)",
              borderRadius: 10,
              background: "var(--surface)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <Button
            variant="primary"
            icon={<Icons.Download />}
            onClick={submit}
            disabled={busy || !input.trim()}
          >
            {busy ? "Collecting…" : mode === "url" ? "Collect" : "Collect top 10"}
          </Button>
        </div>
        {busy && (
          <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
            {mode === "url"
              ? "Scraping slides + comments… this can take 5–15 seconds."
              : "Scraping the profile, then downloading each slideshow + comments… this can take up to a couple of minutes."}
          </div>
        )}
        {busyMsg && (
          <div
            style={{
              padding: "8px 12px",
              font: "400 12.5px var(--font-ui)",
              color: "var(--danger-text)",
              background: "var(--danger-soft)",
              borderRadius: 10,
            }}
          >
            {busyMsg}
          </div>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            font: "400 14px var(--font-ui)",
            color: "var(--ink-3)",
          }}
        >
          Loading collection…
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
            background: "var(--surface)",
          }}
        >
          <div
            style={{
              font: "650 15px var(--font-ui)",
              color: "var(--ink-2)",
              marginBottom: 6,
            }}
          >
            Nothing collected yet
          </div>
          <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
            Paste a TikTok or Instagram post URL, or a creator handle, above to
            start your collection.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          {rows.map((r) => (
            <SlideshowCard key={r.id} slideshow={r} onPatch={patchRow} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Cover-well metric chip: solid success ≥ 1M plays, soft success ≥ 100K,
 *  neutral otherwise (or when only likes are known). */
function coverChipStyle(plays: number | null | undefined): {
  bg: string;
  fg: string;
} {
  if (plays != null && plays >= 1_000_000)
    return { bg: "var(--success)", fg: "var(--on-solid)" };
  if (plays != null && plays >= 100_000)
    return { bg: "var(--success-soft)", fg: "var(--success-text)" };
  return { bg: "var(--neutral-soft)", fg: "var(--neutral-text)" };
}

function SlideshowCard({
  slideshow,
  onPatch,
}: {
  slideshow: ViralSlideshow;
  onPatch: (s: ViralSlideshow) => void;
}) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const isIg = slideshow.platform === "instagram";
  const author = slideshow.author_username
    ? `@${slideshow.author_username}`
    : isIg
      ? "Instagram creator"
      : "TikTok creator";
  const cover = slideshow.slides[0]?.image_url;
  const comments = slideshow.comments ?? [];
  const chip = coverChipStyle(slideshow.play_count);

  const refreshComments = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/viral-slideshows/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: slideshow.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed");
      onPatch(data.slideshow as ViralSlideshow);
      toast(`Fetched ${data.count} comments`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  // ---- Collapsed: tall cover card in the grid ----
  if (!open) {
    return (
      <div
        onClick={() => setOpen(true)}
        title="Open slides + comments"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 8,
          boxShadow: "var(--shadow-card)",
          display: "flex",
          flexDirection: "column",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 280,
            borderRadius: 10,
            background: "var(--surface-2)",
            overflow: "hidden",
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
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              padding: "3px 9px",
              font: "700 12px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              borderRadius: 99,
              background: chip.bg,
              color: chip.fg,
              boxShadow: "var(--shadow-xs)",
            }}
            title={slideshow.play_count != null ? "Plays" : "Likes"}
          >
            {slideshow.play_count != null
              ? `▶ ${compact(slideshow.play_count)}`
              : `♥ ${compact(slideshow.digg_count)}`}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              padding: "2.5px 8px",
              font: "650 10.5px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              borderRadius: 99,
              background: "rgba(29,29,31,0.72)",
              color: "#F5F5F7",
            }}
          >
            {slideshow.slide_count} slide{slideshow.slide_count === 1 ? "" : "s"}
          </div>
        </div>

        <div style={{ padding: "8px 6px 4px", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
            }}
          >
            <SourceTag>{isIg ? "IG" : "TT"}</SourceTag>
            <span
              style={{
                font: "600 13px var(--font-ui)",
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              title={author}
            >
              {author}
            </span>
          </div>
          <div
            style={{
              font: "400 12px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ink-3)",
              marginTop: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {slideshow.play_count != null
              ? `${compact(slideshow.play_count)} plays · `
              : ""}
            {compact(slideshow.digg_count)} likes ·{" "}
            {compact(slideshow.comment_count)} comments
          </div>
        </div>
      </div>
    );
  }

  // ---- Expanded: spans the full grid width ----
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {/* Header row (click to collapse) */}
      <div
        onClick={() => setOpen(false)}
        title="Collapse"
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
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <SourceTag>{isIg ? "IG" : "TT"}</SourceTag>
            <span
              style={{
                font: "600 13px var(--font-ui)",
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={author}
            >
              {author}
            </span>
            <span
              style={{
                font: "400 12px var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
                color: "var(--ink-3)",
                whiteSpace: "nowrap",
              }}
            >
              {slideshow.slide_count} image
              {slideshow.slide_count === 1 ? "" : "s"} · {comments.length}{" "}
              comment{comments.length === 1 ? "" : "s"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {slideshow.play_count != null && (
              <Chip title="Plays">▶ {compact(slideshow.play_count)}</Chip>
            )}
            <Chip title="Likes">♥ {compact(slideshow.digg_count)}</Chip>
            <Chip title="Comments">💬 {compact(slideshow.comment_count)}</Chip>
            {slideshow.share_count != null && (
              <Chip title="Shares">↗ {compact(slideshow.share_count)}</Chip>
            )}
          </div>

          {slideshow.caption && (
            <div
              style={{
                font: "400 12.5px/1.45 var(--font-ui)",
                color: "var(--ink-3)",
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
              font: "400 11.5px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ink-4)",
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

      {/* Expanded: slides, comments, link */}
      <div
        style={{
          borderTop: "1px solid var(--line)",
          padding: isMobile ? 12 : 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Slides */}
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
                    font: "650 10.5px var(--font-ui)",
                    fontVariantNumeric: "tabular-nums",
                    padding: "2.5px 8px",
                    borderRadius: 999,
                    background: "rgba(29,29,31,0.72)",
                    color: "#F5F5F7",
                  }}
                >
                  {i + 1}
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Comments */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div
              style={{
                font: "650 11px var(--font-ui)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--ink-3)",
              }}
            >
              Top comments
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshComments}
              disabled={refreshing}
            >
              {refreshing
                ? "Fetching…"
                : comments.length
                  ? "Refresh"
                  : "Fetch comments"}
            </Button>
          </div>

          {comments.length === 0 ? (
            <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)" }}>
              No comments saved yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {comments.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "var(--surface-2)",
                  }}
                >
                  <div
                    style={{
                      flex: "0 0 auto",
                      font: "400 11px var(--font-ui)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ink-4)",
                      minWidth: 44,
                      textAlign: "right",
                    }}
                    title="Likes"
                  >
                    ♥ {compact(c.likes)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        font: "400 11px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ink-4)",
                        marginBottom: 2,
                      }}
                    >
                      {c.username ? `@${c.username}` : "user"}
                      {c.pinned ? " · 📌 pinned" : ""}
                      {c.reply_count ? ` · ${compact(c.reply_count)} replies` : ""}
                    </div>
                    <div
                      style={{
                        font: "400 12.5px/1.4 var(--font-ui)",
                        color: "var(--ink-2)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {c.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <a
          href={slideshow.tiktok_url}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            font: "600 12px var(--font-ui)",
            color: "var(--ink)",
            textDecoration: "none",
            padding: "7px 12px",
            border: "1px solid var(--line-2)",
            borderRadius: 10,
            background: "var(--surface)",
            boxShadow: "var(--shadow-xs)",
            alignSelf: "flex-start",
          }}
        >
          <Icons.Link size={13} />
          Open on {isIg ? "Instagram" : "TikTok"}
        </a>
      </div>
    </div>
  );
}
