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
import { Button } from "./ui";
import { CategoryTag, ErrorBanner, SectionHeader } from "./porcelain";
import {
  SlideshowTile,
  SlideshowTileDetail,
  tileGridStyle,
} from "./SlideshowTile";
import {
  formatBatchDate,
  problemState,
  stateSummary,
  toTilePost,
  type Batch,
  type BatchPost,
} from "@/lib/batchDisplay";
import { useIsMobile } from "@/lib/useIsMobile";

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
            style={tileGridStyle(isMobile)}
          >
            {batch.posts.map((p) => (
              <SlideshowTile
                key={p.id}
                post={toTilePost(p)}
                // Date-aware: STUCK and NO REACH only apply once the batch date
                // has passed, which the tile's own state->label map can't know.
                problem={problemState(p, batch.batch_date)}
                onOpen={() => setOpenPost(p)}
              />
            ))}
          </div>
        </>
      )}

      {openPost && (
        <SlideshowTileDetail
          post={toTilePost(openPost)}
          onClose={() => setOpenPost(null)}
        />
      )}
    </>
  );
}
