"use client";

/**
 * TikTok batches — the daily nine-persona slideshow batches drafted by the
 * pipeline in the claude repo and queued to Doublespeed.
 *
 * Renders as the first SECTION of Our Slideshows (not a tab — Dan wants
 * everything on one page, grouped, rather than behind a tab click), with the
 * text-card decks grid below it.
 *
 * ONE DAY PER PAGE. This was a stack of collapsed accordion rows, which meant
 * the question the section exists to answer ("did today's nine go out, and how
 * are they doing") took two clicks and then buried the one number that matters
 * under persona/tier/engine/sound/char-count metadata. Now the newest batch is
 * open on arrival as nine bare 9:16 tiles carrying their view counts, and you
 * page back through previous days. Everything else about a post moved into the
 * tile's detail sheet.
 *
 * Tiles stay 9:16 — the slides' true ratio. Cropping them square or 4:5 to
 * match the deck grid below would cut the hook, which sits near the top edge.
 *
 * Rows are pushed by claude/scripts/publish-batch-to-dash.py (Vercel can't read
 * that machine's disk) and read back through /api/slideshow-batches.
 *
 * Every post field except persona can be null: field names drifted across batch
 * vintages (format -> engine, cta added at v22, tier/caption_chars at v28), so
 * older backfilled batches legitimately have gaps. Render around them.
 */

import * as React from "react";
import { Icons } from "./Icons";
import { Button, Chip } from "./ui";
import { Sheet } from "./Sheet";
import {
  CategoryTag,
  ErrorBanner,
  SectionHeader,
  type Family,
} from "./porcelain";
import { overlayPill } from "./tileOverlay";
import {
  TIER_FAMILY,
  fmtViews,
  formatBatchDate,
  problemState,
  stateSummary,
  type Batch,
  type BatchPost,
} from "@/lib/batchDisplay";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { useIsMobile } from "@/lib/useIsMobile";

const isPersonaId = (v: string): v is PersonaId => v in PERSONAS;

// ---- Tile --------------------------------------------------------------

function BatchTile({
  post,
  batchDate,
  onOpen,
}: {
  post: BatchPost;
  batchDate: string;
  onOpen: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const persona = isPersonaId(post.persona) ? PERSONAS[post.persona] : null;
  const problem = problemState(post, batchDate);
  const label = persona?.name ?? post.persona;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      title={post.hook ? `${label} — ${post.hook}` : label}
      aria-label={`${label}${post.hook ? `: ${post.hook}` : ""}`}
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
          aspectRatio: "9 / 16",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-xs)",
          transition: "box-shadow 180ms ease",
        }}
      >
        {post.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.image_url}
            alt={`Slide — ${label}`}
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
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              font: "400 11px var(--font-ui)",
            }}
          >
            no render
          </div>
        )}

        {/* Views: the one number this grid exists to show. */}
        <span style={{ ...overlayPill, bottom: 8, left: 8 }}>
          {fmtViews(post.views)}
        </span>

        {problem && (
          <span
            style={{
              ...overlayPill,
              top: 8,
              right: 8,
              background: "var(--danger)",
              color: "var(--on-solid)",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
            }}
          >
            {problem}
          </span>
        )}
      </div>
    </button>
  );
}

// ---- Detail sheet ------------------------------------------------------

function PostDetail({ post, onClose }: { post: BatchPost; onClose: () => void }) {
  const persona = isPersonaId(post.persona) ? PERSONAS[post.persona] : null;
  const tierFamily = post.tier ? TIER_FAMILY[post.tier] : undefined;

  return (
    <Sheet
      open
      onClose={onClose}
      desktopMaxWidth={560}
      ariaLabel={`${persona?.name ?? post.persona} slide`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: persona?.soft ?? "var(--surface-2)",
              color: "var(--ink)",
              font: "700 10.5px var(--font-ui)",
              padding: "3px 8px",
              borderRadius: 99,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: persona?.color ?? "var(--ink-3)",
              }}
            />
            {persona?.name ?? post.persona}
          </span>
          {post.tier && tierFamily && (
            <CategoryTag family={tierFamily}>{post.tier}</CategoryTag>
          )}
          <span
            style={{
              marginLeft: "auto",
              font: "700 13px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ink)",
            }}
          >
            {fmtViews(post.views)}
            <span style={{ font: "400 11.5px var(--font-ui)", color: "var(--ink-4)" }}>
              {" "}
              views
            </span>
          </span>
        </div>

        {post.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.image_url}
            alt={`Slide — ${persona?.name ?? post.persona}`}
            style={{
              width: "100%",
              maxHeight: "46vh",
              objectFit: "contain",
              borderRadius: 10,
              background: "var(--surface-2)",
              display: "block",
            }}
          />
        )}

        {post.hook && (
          <div style={{ font: "600 15px/1.35 var(--font-ui)", color: "var(--ink)" }}>
            {post.hook}
          </div>
        )}
        {post.second_line && (
          <div
            style={{
              font: "400 12.5px/1.4 var(--font-ui)",
              color: "var(--ink-3)",
              marginTop: -6,
            }}
          >
            {post.second_line}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {post.engine && (
            <Chip tone="neutral" title={post.engine}>
              {post.engine.length > 44 ? `${post.engine.slice(0, 43)}…` : post.engine}
            </Chip>
          )}
          {post.sound && <Chip tone="neutral">♪ {post.sound}</Chip>}
          {typeof post.caption_chars === "number" && (
            <Chip tone="neutral">{post.caption_chars.toLocaleString()} chars</Chip>
          )}
          {post.post_status && <Chip tone="neutral">{post.post_status}</Chip>}
        </div>

        {post.cta && (
          <div style={{ font: "400 12.5px/1.4 var(--font-ui)", color: "var(--ink-2)" }}>
            {post.cta}
          </div>
        )}

        {post.caption && (
          <div
            style={{
              font: "400 12px/1.6 var(--font-ui)",
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: 9,
              padding: 10,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {post.caption}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {post.review_url && (
            <a
              href={post.review_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                font: "600 12.5px var(--font-ui)",
                color: "var(--link)",
                textDecoration: "none",
              }}
            >
              Review ↗
            </a>
          )}
          {/* public_post_url was fetched but never rendered anywhere before —
              the link to the actual live post was the one thing you couldn't
              reach from this screen. */}
          {post.public_post_url && (
            <a
              href={post.public_post_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                font: "600 12.5px var(--font-ui)",
                color: "var(--link)",
                textDecoration: "none",
              }}
            >
              Live post ↗
            </a>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// ---- Section -----------------------------------------------------------

export function SlideshowBatches() {
  const [batches, setBatches] = React.useState<Batch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [openPost, setOpenPost] = React.useState<BatchPost | null>(null);
  const [showAllThesis, setShowAllThesis] = React.useState(false);
  const isMobile = useIsMobile();

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/slideshow-batches", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load");
      setBatches(data.batches as Batch[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // A shorter list after a refresh must not strand the pager past the end.
  const maxPage = Math.max(0, batches.length - 1);
  const safePage = Math.min(page, maxPage);
  const batch = batches[safePage];

  React.useEffect(() => {
    setShowAllThesis(false);
  }, [safePage]);

  // Arrow keys page through days, but not while the detail sheet is open —
  // there the arrows belong to whatever has focus inside it.
  React.useEffect(() => {
    if (openPost || batches.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPage((p) => Math.min(maxPage, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPost, batches.length, maxPage]);

  const summary = batch ? stateSummary(batch.posts, batch.batch_date) : null;
  const thesis = batch?.experiment ?? batch?.note ?? null;

  return (
    <>
      <SectionHeader
        family="accent"
        icon="Sparkles"
        title="TikTok batches"
        meta="nine personas a day, queued to Doublespeed"
        style={{ marginTop: 0 }}
        right={
          <button
            type="button"
            onClick={refresh}
            title="Refresh batches"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              font: "600 12px var(--font-ui)",
              color: "var(--ink-3)",
            }}
          >
            <Icons.Refresh size={13} />
            Refresh
          </button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "repeat(2, minmax(0, 1fr))"
              : "repeat(auto-fill, minmax(190px, 1fr))",
            gap: isMobile ? 10 : 14,
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              style={{
                aspectRatio: "9 / 16",
                borderRadius: 12,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                animation: "dmPulse 1.6s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      ) : !batch ? (
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
            No batches yet
          </div>
          <div style={{ font: "400 13px var(--font-ui)" }}>
            Run scripts/publish-batch-to-dash.py in the claude repo after drafting
            a batch.
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <span style={{ font: "600 17px var(--font-display)", color: "var(--ink)" }}>
              Batch {batch.batch_no ?? batch.batch_key}
            </span>
            <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>
              {formatBatchDate(batch.batch_date)}
            </span>
            <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
              {batch.posts.length} posts
            </span>
            {summary && (
              <CategoryTag family={summary.family}>{summary.label}</CategoryTag>
            )}

            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
              >
                ← Newer
              </Button>
              <span
                style={{
                  font: "500 12px var(--font-ui)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {safePage + 1} of {batches.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(Math.min(maxPage, safePage + 1))}
                disabled={safePage >= maxPage}
              >
                Older →
              </Button>
            </span>
          </div>

          {thesis && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  font: "400 12.5px/1.55 var(--font-ui)",
                  color: "var(--ink-2)",
                  whiteSpace: "pre-wrap",
                  maxHeight: showAllThesis ? undefined : 66,
                  overflow: "hidden",
                }}
              >
                {thesis}
              </div>
              {thesis.length > 200 && (
                <button
                  type="button"
                  onClick={() => setShowAllThesis((v) => !v)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "6px 0 0",
                    cursor: "pointer",
                    font: "600 11.5px var(--font-ui)",
                    color: "var(--ink-3)",
                  }}
                >
                  {showAllThesis ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          <div
            data-testid="batch-tiles"
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(auto-fill, minmax(190px, 1fr))",
              gap: isMobile ? 10 : 14,
              alignItems: "start",
            }}
          >
            {batch.posts.map((p) => (
              <BatchTile
                key={p.id}
                post={p}
                batchDate={batch.batch_date}
                onOpen={() => setOpenPost(p)}
              />
            ))}
          </div>
        </>
      )}

      {openPost && (
        <PostDetail post={openPost} onClose={() => setOpenPost(null)} />
      )}
    </>
  );
}
