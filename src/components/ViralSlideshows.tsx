"use client";

import * as React from "react";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div
          className="serif"
          style={{ fontSize: 26, fontStyle: "italic", color: "var(--ink)" }}
        >
          Viral Slideshows
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
          Collect TikTok slideshows &amp; Instagram carousels for analysis. Paste
          a single post URL, or pull a creator&rsquo;s top 10. Every image and the
          top 20 comments are downloaded into our library.
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
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {/* Platform toggle */}
          <div style={{ display: "inline-flex", gap: 4 }}>
            {(["tiktok", "instagram"] as Platform[]).map((p) => (
              <button
                key={p}
                onClick={() => !busy && setPlatform(p)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 8,
                  cursor: busy ? "not-allowed" : "pointer",
                  border: "1px solid var(--line)",
                  background: platform === p ? "var(--accent)" : "var(--surface-2)",
                  color: platform === p ? "#fff" : "var(--ink-2)",
                }}
              >
                {p === "tiktok" ? "TikTok" : "Instagram"}
              </button>
            ))}
          </div>

          {/* Mode toggle */}
          <div style={{ display: "inline-flex", gap: 4 }}>
            {(["url", "profile"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => !busy && setMode(m)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 8,
                  cursor: busy ? "not-allowed" : "pointer",
                  border: "1px solid var(--line)",
                  background: mode === m ? "var(--ink)" : "var(--surface-2)",
                  color: mode === m ? "var(--surface)" : "var(--ink-2)",
                }}
              >
                {m === "url" ? "Single URL" : "Profile · top 10"}
              </button>
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
            onClick={submit}
            disabled={busy || !input.trim()}
          >
            {busy ? "Collecting…" : mode === "url" ? "Collect" : "Collect top 10"}
          </Button>
        </div>
        {busy && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {mode === "url"
              ? "Scraping slides + comments… this can take 5–15 seconds."
              : "Scraping the profile, then downloading each slideshow + comments… this can take up to a couple of minutes."}
          </div>
        )}
        {busyMsg && (
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
            {busyMsg}
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
            Nothing collected yet
          </div>
          <div style={{ fontSize: 13 }}>
            Paste a TikTok or Instagram post URL, or a creator handle, above to
            start your collection.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rows.map((r) => (
            <SlideshowCard key={r.id} slideshow={r} onPatch={patchRow} />
          ))}
        </div>
      )}
    </div>
  );
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
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 5,
                fontSize: 9.5,
                color: "#fff",
                background: isIg ? "#C13584" : "var(--ink-3)",
              }}
            >
              {isIg ? "IG" : "TT"}
            </span>
            {author} · {slideshow.slide_count} image
            {slideshow.slide_count === 1 ? "" : "s"} · {comments.length} comment
            {comments.length === 1 ? "" : "s"}
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

      {/* Expanded: slides, comments, link */}
      {open && (
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
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--ink-4)",
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
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-4)",
                  fontStyle: "italic",
                }}
              >
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
                      padding: "8px 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      background: "var(--surface-2)",
                    }}
                  >
                    <div
                      style={{
                        flex: "0 0 auto",
                        fontSize: 11,
                        fontFamily: "var(--font-geist-mono), monospace",
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
                          fontSize: 11,
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
                          fontSize: 12.5,
                          color: "var(--ink-2)",
                          lineHeight: 1.4,
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
            Open on {isIg ? "Instagram" : "TikTok"}
          </a>
        </div>
      )}
    </div>
  );
}
