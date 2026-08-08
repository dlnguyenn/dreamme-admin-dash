"use client";

/**
 * "This morning's posts" — the daily routines' output as an Instagram-style
 * tile grid, one tile per SET (not per platform: the FB and IG posts are the
 * same creative). The glance this exists for: every expected set has a tile,
 * healthy tiles are bare, anything needing Dan carries a red flag, and a
 * routine that didn't run shows as a dashed gap.
 *
 * Deliberately its own tile component rather than reusing SlideshowTile: that
 * one is persona/views-bound (views pill, persona registry) and 9:16, and
 * forcing TilePost here would render a meaningless "—" views badge on every
 * card.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  STATUS_LABEL,
  coverageFlag,
  type MorningSection,
  type MorningTile as MorningTileData,
  type MorningTileState,
} from "@/lib/morningPosts";
import { Card, SectionHeader, StatusPill, fam } from "../porcelain";
import { Sheet } from "../Sheet";
import { Chip } from "../ui";
import { overlayPill } from "../tileOverlay";
import { EmptyState } from "./shared";

const PLATFORM_SHORT: Record<string, string> = {
  facebook: "FB",
  instagram: "IG",
};

/**
 * Colour per state. Only two states resolve themselves — queued and posted —
 * so everything else reads as needing a person, which is the distinction the
 * panel exists to make.
 */
const STATE_FAMILY: Record<MorningTileState, Parameters<typeof fam>[0]> = {
  posted: "success",
  scheduled: "info",
  draft: "warning",
  failed: "danger",
  missing: "danger",
  unknown: "warning",
};

function statusPillStyle(state: MorningTileState): React.CSSProperties {
  const f = fam(STATE_FAMILY[state]);
  return {
    ...overlayPill,
    background: f.solid,
    color: f.onSolid,
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
  };
}

/** Past this many sets, one row would make the tiles too small to read. */
const MAX_ONE_ROW = 9;

/**
 * IG profile grid: uniform 4:5 cells, tight gaps, no per-row labels. Local
 * rather than a change to the shared tileGridStyle — the persona grids on this
 * same page depend on that being 9:16 at 190px, and the two grids are showing
 * different things.
 *
 * Desktop columns track the tile COUNT rather than a minmax width, so the whole
 * roster lands on exactly one row and stays flush to both edges. auto-fill with
 * a fixed min put 6 across and orphaned the 7th on a second row, which defeats
 * the point of a one-glance strip.
 */
function morningGridStyle(isMobile: boolean, count: number): React.CSSProperties {
  const cols = Math.min(Math.max(count, 1), MAX_ONE_ROW);
  return {
    display: "grid",
    gridTemplateColumns: isMobile
      ? "repeat(3, minmax(0, 1fr))"
      : `repeat(${cols}, minmax(0, 1fr))`,
    gap: isMobile ? 2 : 3,
    alignItems: "start",
  };
}

/** Shared by the real and the missing tile so the grid stays uniform. */
const cellStyle: React.CSSProperties = {
  position: "relative",
  aspectRatio: "4 / 5",
  borderRadius: 4,
  overflow: "hidden",
};

function TileLabel({ tile }: { tile: MorningTileData }) {
  return (
    <div
      title={tile.routine}
      style={{
        font: "500 11px var(--font-ui)",
        color: "var(--ink-4)",
        marginTop: 5,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {tile.setLabel}
    </div>
  );
}

function MissingMorningTile({ tile }: { tile: MorningTileData }) {
  return (
    <div>
      <div
        title={`${tile.setLabel} — ${tile.action ?? "nothing created this morning"}`}
        style={{
          ...cellStyle,
          border: "1px dashed var(--warning)",
          background: "var(--warning-soft)",
          display: "grid",
          placeItems: "center",
          padding: 6,
          textAlign: "center",
        }}
      >
        <div
          style={{
            font: "600 9px var(--font-ui)",
            letterSpacing: "0.04em",
            color: "var(--warning-text)",
          }}
        >
          NOT CREATED
        </div>
      </div>
      <TileLabel tile={tile} />
    </div>
  );
}

function MorningTileCard({
  tile,
  onOpen,
}: {
  tile: MorningTileData;
  onOpen: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  if (tile.coverage === "none") return <MissingMorningTile tile={tile} />;

  const flag = coverageFlag(tile.coverage);

  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        title={tile.caption ? `${tile.setLabel} — ${tile.caption}` : tile.setLabel}
        aria-label={tile.setLabel}
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
            ...cellStyle,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            boxShadow: hover ? "var(--shadow-md)" : "none",
            transition: "box-shadow 180ms ease",
          }}
        >
          {tile.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tile.thumbUrl}
              alt={tile.setLabel}
              loading="lazy"
              decoding="async"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                // TOP-anchored, not centred. Both formats put their
                // identifying content near the top of a 9:16 frame — deck
                // cover hooks sit at the top edge (see SlideshowTile.tsx),
                // and a wall-of-text still shows her face plus the opening
                // lines. A centred crop would decapitate the decks.
                objectPosition: "top",
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
                font: "400 10px var(--font-ui)",
              }}
            >
              no thumbnail
            </div>
          )}

          {/* EVERY tile carries its status. The earlier design left healthy
              tiles bare, which looked cleaner but meant a queued post and a
              stuck draft were visually identical — the one question Dan
              actually needs this grid to answer. */}
          <span style={{ ...statusPillStyle(tile.state), bottom: 6, left: 6 }}>
            {STATUS_LABEL[tile.state]}
          </span>

          {flag && (
            <span
              style={{
                ...overlayPill,
                top: 6,
                right: 6,
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
      <TileLabel tile={tile} />
    </div>
  );
}

function MorningTileDetail({
  tile,
  onClose,
}: {
  tile: MorningTileData;
  onClose: () => void;
}) {
  // Same creative on every surface, so the first entry that has a render is
  // the one to play.
  const video = tile.platforms.find((p) => p.videoUrl)?.videoUrl ?? null;

  return (
    <Sheet open onClose={onClose} desktopMaxWidth={560} ariaLabel={`${tile.setLabel} post`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Chip tone="neutral">{tile.setLabel}</Chip>
          <Chip tone="neutral">{tile.routine}</Chip>
          <Chip tone="neutral">{tile.postKind}</Chip>
          <Chip tone={STATE_FAMILY[tile.state]}>{STATUS_LABEL[tile.state]}</Chip>
        </div>

        {tile.action && (
          <div
            style={{
              font: "600 12.5px/1.45 var(--font-ui)",
              color: "var(--warning-text)",
              background: "var(--warning-soft)",
              border: "1px solid var(--warning)",
              borderRadius: 9,
              padding: "8px 10px",
            }}
          >
            {tile.action}
          </div>
        )}

        {tile.postKind === "video" && video ? (
          // The one video element in the dash, Sheet-only by design — the grid
          // stays images so 7 tiles never buffer 7 videos.
          <video
            controls
            preload="none"
            playsInline
            src={video}
            poster={tile.thumbUrl ?? undefined}
            style={{
              width: "100%",
              maxHeight: "46vh",
              borderRadius: 10,
              background: "var(--surface-2)",
              display: "block",
            }}
          />
        ) : tile.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tile.thumbUrl}
            alt={tile.setLabel}
            style={{
              width: "100%",
              maxHeight: "46vh",
              // Uncropped here — the grid's 4:5 crop is for density, but the
              // detail view should show what actually went out.
              objectFit: "contain",
              borderRadius: 10,
              background: "var(--surface-2)",
              display: "block",
            }}
          />
        ) : null}

        {/* One row per platform: this is where the collapsed tile gives back
            its per-surface detail, including each platform's own sound. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tile.platforms.map((p) => (
            <div
              key={p.platform}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                font: "400 12px var(--font-ui)",
                color: "var(--ink-2)",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "7px 10px",
              }}
            >
              <span style={{ font: "700 11px var(--font-ui)", color: "var(--ink)" }}>
                {PLATFORM_SHORT[p.platform] ?? p.platform}
              </span>
              {p.username && <span style={{ color: "var(--ink-4)" }}>@{p.username}</span>}
              <Chip tone={p.state === "posted" ? "success" : "neutral"}>{p.state}</Chip>
              {p.sound && <span style={{ color: "var(--ink-4)" }}>♪ {p.sound}</span>}
              {p.publicPostUrl && (
                <a
                  href={p.publicPostUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    marginLeft: "auto",
                    font: "600 12px var(--font-ui)",
                    color: "var(--link)",
                    textDecoration: "none",
                  }}
                >
                  Live post ↗
                </a>
              )}
            </div>
          ))}
          {tile.coverage !== "both" && (
            <div style={{ font: "600 11.5px var(--font-ui)", color: "var(--danger)" }}>
              Only went to {PLATFORM_SHORT[tile.coverage] ?? tile.coverage} — the other
              surface has no post for this set today.
            </div>
          )}
        </div>

        {tile.caption && (
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
            {tile.caption}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function MorningPanel({ morning }: { morning: MorningSection | null }) {
  const isMobile = useIsMobile();
  const [openTile, setOpenTile] = React.useState<MorningTileData | null>(null);

  const needs = morning?.actionNeeded ?? 0;

  return (
    <div>
      <SectionHeader
        family={needs > 0 ? "warning" : "success"}
        icon="Sun"
        title="This morning's posts"
        meta={morning ? morning.date : undefined}
        right={
          morning ? (
            // The verdict, stated rather than implied. The old header made you
            // add up pills to work out whether you were done.
            <span
              style={{
                font: "700 12px var(--font-ui)",
                color: needs > 0 ? "var(--warning-text)" : "var(--success-text)",
              }}
            >
              {needs > 0
                ? `${needs} need${needs === 1 ? "s" : ""} you`
                : "Nothing to do"}
            </span>
          ) : undefined
        }
      />
      <Card pad={isMobile ? "14px 14px" : "18px 20px"}>
        {!morning ? (
          <EmptyState title="Morning posts unavailable">
            The section failed to load — see the error banner.
          </EmptyState>
        ) : morning.created === 0 ? (
          <EmptyState title="Nothing published yet this morning">
            Tiles appear once the routines run <code>publish-morning-posts.py</code>.
          </EmptyState>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <StatusPill
                kind={morning.created === morning.expected ? "running" : "danger"}
              >
                {morning.created}/{morning.expected} CREATED
              </StatusPill>
              {/* The two self-resolving states, so a clean morning still
                  says something rather than showing an empty pill row. */}
              {morning.queued > 0 && (
                <StatusPill kind="neutral">{morning.queued} QUEUED</StatusPill>
              )}
              {morning.posted > 0 && (
                <StatusPill kind="success">{morning.posted} POSTED</StatusPill>
              )}
              {/* Everything below needs a person. */}
              {morning.drafts > 0 && (
                <StatusPill kind="attention">{morning.drafts} IN DRAFT</StatusPill>
              )}
              {morning.partial > 0 && (
                <StatusPill kind="danger">{morning.partial} PARTIAL</StatusPill>
              )}
              {morning.missing > 0 && (
                <StatusPill kind="danger">{morning.missing} MISSING</StatusPill>
              )}
              {morning.failed > 0 && (
                <StatusPill kind="danger">{morning.failed} FAILED</StatusPill>
              )}
            </div>

            <div
              data-testid="morning-tiles"
              style={morningGridStyle(isMobile, morning.tiles.length)}
            >
              {morning.tiles.map((t) => (
                <MorningTileCard
                  key={t.setKey}
                  tile={t}
                  onOpen={() => setOpenTile(t)}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      {openTile && (
        <MorningTileDetail tile={openTile} onClose={() => setOpenTile(null)} />
      )}
    </div>
  );
}
