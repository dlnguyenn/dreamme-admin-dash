"use client";

/**
 * TikTok batches — the daily nine-persona slideshow batches drafted by the
 * pipeline in the claude repo and queued to Doublespeed.
 *
 * Renders as the first SECTION of Our Slideshows (not a tab — Dan wants
 * everything on one page, grouped, rather than behind a tab click), with the
 * text-card decks grid below it. Each batch is its own collapsible group.
 *
 * Rows are pushed by claude/scripts/publish-batch-to-dash.py (Vercel can't read
 * that machine's disk) and read back through /api/slideshow-batches. Lives in
 * its own file so OurSlideshows.tsx doesn't grow past its already-large size.
 *
 * Every post field except persona can be null: field names drifted across batch
 * vintages (format -> engine, cta added at v22, tier/caption_chars at v28), so
 * older backfilled batches legitimately have gaps. Render around them.
 */

import * as React from "react";
import { Icons } from "./Icons";
import { Chip } from "./ui";
import {
  CategoryTag,
  ErrorBanner,
  SectionHeader,
  type Family,
} from "./porcelain";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { useIsMobile } from "@/lib/useIsMobile";

interface BatchPost {
  id: string;
  batch_key: string;
  persona: string;
  sort_order: number;
  hook: string | null;
  second_line: string | null;
  engine: string | null;
  cta: string | null;
  sound: string | null;
  tier: string | null;
  caption_chars: number | null;
  caption: string | null;
  review_url: string | null;
  doublespeed_post_id: string | null;
  post_status: string | null;
  posted_at: string | null;
  public_post_url: string | null;
  image_url: string | null;
}

interface Batch {
  id: string;
  batch_key: string;
  batch_no: number | null;
  batch_date: string;
  status: string | null;
  experiment: string | null;
  note: string | null;
  render_note: string | null;
  post_count: number;
  posts: BatchPost[];
}

const TIER_FAMILY: Record<string, Family> = {
  SHORT: "info",
  MED: "success",
  LONG: "attention",
};

const isPersonaId = (v: string): v is PersonaId => v in PERSONAS;

/**
 * Live state summary for a batch.
 *
 * Deliberately NOT derived from slideshow_batches.status — that column holds a
 * free-text snapshot written once at publish time ("QUEUED (all 9, ...)"), so
 * showing it made three-week-old batches read as still queued. These counts
 * come from post_status, refreshed from Doublespeed.
 */
function stateSummary(posts: BatchPost[]): {
  label: string;
  family: Family;
} | null {
  if (posts.length === 0) return null;
  const n = (s: string) => posts.filter((p) => p.post_status === s).length;
  const posted = n("posted") + n("succeeded");
  const queued = n("scheduled") + n("pending");
  const draft = n("draft");
  const failed = n("failed") + n("error");
  const total = posts.length;

  if (failed > 0) return { label: `${failed} FAILED`, family: "danger" };
  if (draft > 0) return { label: `${draft} NOT POSTED`, family: "danger" };
  if (posted === total) return { label: "POSTED", family: "success" };
  if (queued === total) return { label: "QUEUED", family: "attention" };
  if (posted > 0 || queued > 0)
    return { label: `${posted}/${total} POSTED`, family: "attention" };
  return { label: "UNVERIFIED", family: "neutral" };
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ---- Post card ---------------------------------------------------------

function PostCard({ post }: { post: BatchPost }) {
  const [showCaption, setShowCaption] = React.useState(false);
  const persona = isPersonaId(post.persona) ? PERSONAS[post.persona] : null;
  const tierFamily = post.tier ? TIER_FAMILY[post.tier] : undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 10,
      }}
    >
      {post.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.image_url}
          alt={`Slide — ${persona?.name ?? post.persona}`}
          loading="lazy"
          decoding="async"
          style={{
            width: "100%",
            aspectRatio: "9 / 16",
            objectFit: "cover",
            borderRadius: 9,
            background: "var(--surface-2)",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            aspectRatio: "9 / 16",
            borderRadius: 9,
            border: "1px dashed var(--line-2)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
            font: "400 11px var(--font-ui)",
          }}
        >
          no render
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
      </div>

      {post.hook && (
        <div style={{ font: "600 13px/1.35 var(--font-ui)", color: "var(--ink)" }}>
          {post.hook}
        </div>
      )}
      {post.second_line && (
        <div
          style={{
            font: "400 11.5px/1.35 var(--font-ui)",
            color: "var(--ink-3)",
            marginTop: -4,
          }}
        >
          {post.second_line}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {post.engine && (
          <Chip tone="neutral" title={post.engine}>
            {post.engine.length > 34 ? `${post.engine.slice(0, 33)}…` : post.engine}
          </Chip>
        )}
        {post.sound && <Chip tone="neutral">♪ {post.sound}</Chip>}
        {typeof post.caption_chars === "number" && (
          <Chip tone="neutral">{post.caption_chars.toLocaleString()} chars</Chip>
        )}
      </div>

      {post.cta && (
        <div style={{ font: "400 11.5px/1.4 var(--font-ui)", color: "var(--ink-2)" }}>
          {post.cta}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: "auto",
          paddingTop: 4,
        }}
      >
        {post.caption && (
          <button
            type="button"
            onClick={() => setShowCaption((v) => !v)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              font: "600 11.5px var(--font-ui)",
              color: "var(--ink-3)",
            }}
          >
            {showCaption ? "Hide caption" : "Caption"}
          </button>
        )}
        {post.review_url && (
          <a
            href={post.review_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              font: "600 11.5px var(--font-ui)",
              color: "var(--link)",
              textDecoration: "none",
            }}
          >
            Review ↗
          </a>
        )}
      </div>

      {showCaption && post.caption && (
        <div
          style={{
            font: "400 11.5px/1.6 var(--font-ui)",
            color: "var(--ink-2)",
            whiteSpace: "pre-wrap",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 9,
            padding: 9,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {post.caption}
        </div>
      )}
    </div>
  );
}

// ---- Batch card --------------------------------------------------------

function BatchCard({
  batch,
  expanded,
  onToggle,
  isMobile,
}: {
  batch: Batch;
  expanded: boolean;
  onToggle: () => void;
  isMobile: boolean;
}) {
  const [showAllThesis, setShowAllThesis] = React.useState(false);
  const thesis = batch.experiment ?? batch.note;
  const summary = stateSummary(batch.posts);

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 16,
        background: "var(--surface)",
        boxShadow: "var(--shadow-xs)",
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: isMobile ? "12px 14px" : "14px 18px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            color: "var(--ink-3)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 120ms ease",
          }}
        >
          <Icons.ChevronRight />
        </span>
        <span style={{ font: "600 17px var(--font-display)", color: "var(--ink)" }}>
          Batch {batch.batch_no ?? batch.batch_key}
        </span>
        <span style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-3)" }}>
          {formatDate(batch.batch_date)}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
            {batch.posts.length} posts
          </span>
          {summary && (
            <CategoryTag family={summary.family}>{summary.label}</CategoryTag>
          )}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: isMobile ? "0 14px 14px" : "0 18px 18px" }}>
          {thesis && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  font: "400 12.5px/1.55 var(--font-ui)",
                  color: "var(--ink-2)",
                  whiteSpace: "pre-wrap",
                  maxHeight: showAllThesis ? undefined : 120,
                  overflow: "hidden",
                }}
              >
                {thesis}
              </div>
              {thesis.length > 320 && (
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
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(auto-fill, minmax(210px, 1fr))",
              gap: isMobile ? 10 : 14,
              alignItems: "stretch",
            }}
          >
            {batch.posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Section -----------------------------------------------------------

export function SlideshowBatches() {
  const [batches, setBatches] = React.useState<Batch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const seeded = React.useRef(false);
  const isMobile = useIsMobile();

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/slideshow-batches", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load");
      const rows = data.batches as Batch[];
      setBatches(rows);
      // Open the newest batch on first load only, so a refresh doesn't fight
      // whatever the user has expanded.
      if (!seeded.current && rows.length > 0) {
        seeded.current = true;
        setOpen(new Set([rows[0].batch_key]));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
        <div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 62,
                borderRadius: 16,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                marginBottom: 12,
                animation: "dmPulse 1.6s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      ) : batches.length === 0 ? (
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
        batches.map((b) => (
          <BatchCard
            key={b.batch_key}
            batch={b}
            expanded={open.has(b.batch_key)}
            onToggle={() => toggle(b.batch_key)}
            isMobile={isMobile}
          />
        ))
      )}
    </>
  );
}
