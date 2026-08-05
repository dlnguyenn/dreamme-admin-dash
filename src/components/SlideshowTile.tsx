"use client";

/**
 * The 9:16 slide tile and its detail sheet, shared by Our Slideshows (paged
 * batch history) and the Overview's "Going out today".
 *
 * Lives in its own file because both screens render the same thing and a
 * second copy would drift — the two views of a batch disagreeing about whether
 * a post is queued is exactly the class of bug this pipeline keeps producing.
 *
 * Tiles are 9:16, the slides' true ratio. Cropping to match the 4:5 text-card
 * grid would cut the hook, which sits near the top edge.
 */

import * as React from "react";
import { Sheet } from "./Sheet";
import { Chip } from "./ui";
import { CategoryTag } from "./porcelain";
import { overlayPill } from "./tileOverlay";
import { TIER_FAMILY, fmtViews, type TilePost } from "@/lib/batchDisplay";
import { PERSONAS, type PersonaId } from "@/lib/personas";

const isPersonaId = (v: string): v is PersonaId => v in PERSONAS;

export const personaLabel = (persona: string) =>
  isPersonaId(persona) ? PERSONAS[persona].name : persona;

/**
 * A slot with no post at all — the persona is on the daily roster but nothing
 * has been drafted for them.
 *
 * Rendered as a dashed outline rather than omitted, because "which still need
 * to be queued" is only answerable if the gap is visible. An absent tile in a
 * grid of eight reads as a complete grid of eight.
 */
function MissingTile({ persona }: { persona: string }) {
  return (
    <div
      title={`${personaLabel(persona)} — not queued yet`}
      style={{
        position: "relative",
        aspectRatio: "9 / 16",
        borderRadius: 12,
        border: "1px dashed var(--warning)",
        background: "var(--warning-soft)",
        display: "grid",
        placeItems: "center",
        gap: 4,
        padding: 8,
        textAlign: "center",
      }}
    >
      <div>
        <div
          style={{
            font: "700 11px var(--font-ui)",
            color: "var(--warning-text)",
            marginBottom: 3,
          }}
        >
          {personaLabel(persona)}
        </div>
        <div
          style={{
            font: "600 9.5px var(--font-ui)",
            letterSpacing: "0.04em",
            color: "var(--warning-text)",
            opacity: 0.85,
          }}
        >
          NOT QUEUED
        </div>
      </div>
    </div>
  );
}

/**
 * Per-post problem label, or null when fine.
 *
 * Healthy tiles stay bare so a broken one is impossible to miss. The batch pill
 * says "1 NOT POSTED" without naming the persona, and finding exactly that is
 * what caught b28/maya silently reverting to draft.
 */
export function tileProblem(state: string): string | null {
  switch (state) {
    case "failed":
      return "FAILED";
    case "draft":
      return "NOT POSTED";
    default:
      return null;
  }
}

export function SlideshowTile({
  post,
  onOpen,
  problem,
}: {
  post: TilePost;
  onOpen: () => void;
  /** Overrides the state-derived label — lets a caller add date-aware cases. */
  problem?: string | null;
}) {
  const [hover, setHover] = React.useState(false);
  const label = personaLabel(post.persona);
  const flag = problem !== undefined ? problem : tileProblem(post.state);

  if (post.state === "missing") return <MissingTile persona={post.persona} />;

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
        {post.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.imageUrl}
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

        {flag && (
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
            {flag}
          </span>
        )}
      </div>
    </button>
  );
}

// ---- Detail sheet ------------------------------------------------------

export function SlideshowTileDetail({
  post,
  onClose,
}: {
  post: TilePost;
  onClose: () => void;
}) {
  const persona = isPersonaId(post.persona) ? PERSONAS[post.persona] : null;
  const tierFamily = post.tier ? TIER_FAMILY[post.tier] : undefined;

  return (
    <Sheet
      open
      onClose={onClose}
      desktopMaxWidth={560}
      ariaLabel={`${personaLabel(post.persona)} slide`}
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
            {personaLabel(post.persona)}
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

        {post.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.imageUrl}
            alt={`Slide — ${personaLabel(post.persona)}`}
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
        {post.secondLine && (
          <div
            style={{
              font: "400 12.5px/1.4 var(--font-ui)",
              color: "var(--ink-3)",
              marginTop: -6,
            }}
          >
            {post.secondLine}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {post.engine && (
            <Chip tone="neutral" title={post.engine}>
              {post.engine.length > 44 ? `${post.engine.slice(0, 43)}…` : post.engine}
            </Chip>
          )}
          {post.sound && <Chip tone="neutral">♪ {post.sound}</Chip>}
          {typeof post.captionChars === "number" && (
            <Chip tone="neutral">{post.captionChars.toLocaleString()} chars</Chip>
          )}
          <Chip tone="neutral">{post.state}</Chip>
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
          {post.reviewUrl && (
            <a
              href={post.reviewUrl}
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
          {post.postUrl && (
            <a
              href={post.postUrl}
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

/** Shared grid container so both screens lay tiles out identically. */
export function tileGridStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(auto-fill, minmax(190px, 1fr))",
    gap: isMobile ? 10 : 14,
    alignItems: "start",
  };
}
