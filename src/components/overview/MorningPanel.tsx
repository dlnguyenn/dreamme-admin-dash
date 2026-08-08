"use client";

/**
 * "This morning's posts" — the daily routine output on the FB/IG account
 * sets, as tiles. The glance this exists for: every expected set x platform
 * pair has a tile, healthy tiles are bare, anything needing Dan is flagged,
 * and a routine that didn't run shows as dashed NOT CREATED gaps.
 *
 * Deliberately its own tile component rather than reusing SlideshowTile:
 * that one is persona/views-bound (views pill, persona registry) and forcing
 * TilePost here would render a meaningless "—" views badge on every card.
 * The visual language (9:16 card, overlay pills, dashed missing slot) is
 * copied so the two grids read as one system.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  morningTileProblem,
  type MorningSection,
  type MorningTile as MorningTileData,
} from "@/lib/morningPosts";
import { Card, SectionHeader, StatusPill } from "../porcelain";
import { Sheet } from "../Sheet";
import { Chip } from "../ui";
import { overlayPill } from "../tileOverlay";
import { tileGridStyle } from "../SlideshowTile";
import { EmptyState } from "./shared";

const PLATFORM_SHORT: Record<string, string> = {
  facebook: "FB",
  instagram: "IG",
};

function MissingMorningTile({ tile }: { tile: MorningTileData }) {
  return (
    <div
      title={`${tile.setLabel} ${PLATFORM_SHORT[tile.platform]} — not created this morning`}
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
          {tile.setLabel} {PLATFORM_SHORT[tile.platform]}
        </div>
        <div
          style={{
            font: "600 9.5px var(--font-ui)",
            letterSpacing: "0.04em",
            color: "var(--warning-text)",
            opacity: 0.85,
          }}
        >
          NOT CREATED
        </div>
      </div>
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
  if (tile.state === "missing") return <MissingMorningTile tile={tile} />;

  const flag = morningTileProblem(tile.state);
  const label = `${tile.setLabel} ${PLATFORM_SHORT[tile.platform]}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      title={tile.caption ? `${label} — ${tile.caption}` : label}
      aria-label={label}
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
        {tile.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tile.thumbUrl}
            alt={`Post — ${label}`}
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
            no thumbnail
          </div>
        )}

        {/* Platform is the one fact the persona grid never needed and this
            grid cannot live without — the same set posts to both surfaces. */}
        <span style={{ ...overlayPill, top: 8, left: 8 }}>
          {PLATFORM_SHORT[tile.platform]}
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

function MorningTileDetail({
  tile,
  onClose,
}: {
  tile: MorningTileData;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onClose={onClose}
      desktopMaxWidth={560}
      ariaLabel={`${tile.setLabel} ${PLATFORM_SHORT[tile.platform]} post`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Chip tone="neutral">{tile.setLabel}</Chip>
          <Chip tone="neutral">{PLATFORM_SHORT[tile.platform]}</Chip>
          {tile.username && <Chip tone="neutral">@{tile.username}</Chip>}
          <Chip tone="neutral">{tile.state}</Chip>
        </div>

        {tile.postKind === "video" && tile.videoUrl ? (
          // The one video element in the dash, Sheet-only by design — the
          // grid stays images so 14 tiles never buffer 14 videos.
          <video
            controls
            preload="none"
            playsInline
            src={tile.videoUrl}
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
            alt={`Post — ${tile.setLabel}`}
            style={{
              width: "100%",
              maxHeight: "46vh",
              objectFit: "contain",
              borderRadius: 10,
              background: "var(--surface-2)",
              display: "block",
            }}
          />
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {tile.sound && <Chip tone="neutral">♪ {tile.sound}</Chip>}
          <Chip tone="neutral">{tile.postKind}</Chip>
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

        {tile.publicPostUrl && (
          <a
            href={tile.publicPostUrl}
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
    </Sheet>
  );
}

export function MorningPanel({ morning }: { morning: MorningSection | null }) {
  const isMobile = useIsMobile();
  const [openTile, setOpenTile] = React.useState<MorningTileData | null>(null);

  const attention = (morning?.missing ?? 0) + (morning?.failed ?? 0) > 0;

  return (
    <div>
      <SectionHeader
        family={attention ? "warning" : "accent"}
        icon="Sun"
        title="This morning's posts"
        meta={
          morning ? `${morning.created}/${morning.expected} created · ${morning.date}` : undefined
        }
      />
      <Card pad={isMobile ? "14px 14px" : "18px 20px"}>
        {!morning ? (
          <EmptyState title="Morning posts unavailable">
            The section failed to load — see the error banner.
          </EmptyState>
        ) : morning.created === 0 && morning.missing === morning.expected ? (
          <EmptyState title="Nothing published yet this morning">
            Tiles appear once the routines run{" "}
            <code>publish-morning-posts.py</code>.
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
              {morning.posted > 0 && (
                <StatusPill kind="running">{morning.posted} POSTED</StatusPill>
              )}
              {/* Drafts awaiting promotion are the EXPECTED morning state,
                  not a problem — attention, never danger. */}
              {morning.drafts > 0 && (
                <StatusPill kind="attention">{morning.drafts} DRAFT</StatusPill>
              )}
              {morning.missing > 0 && (
                <StatusPill kind="danger">{morning.missing} MISSING</StatusPill>
              )}
              {morning.failed > 0 && (
                <StatusPill kind="danger">{morning.failed} FAILED</StatusPill>
              )}
            </div>

            <div
              data-testid="morning-groups"
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              {morning.groups.map((g) => (
                <div key={g.setKey}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ font: "700 12.5px var(--font-ui)", color: "var(--ink)" }}>
                      {g.label}
                    </span>
                    <span style={{ font: "400 11px var(--font-ui)", color: "var(--ink-4)" }}>
                      {g.routine}
                    </span>
                  </div>
                  <div
                    data-testid={`morning-tiles-${g.setKey}`}
                    style={{
                      ...tileGridStyle(isMobile),
                      gridTemplateColumns: isMobile
                        ? "repeat(2, minmax(0, 1fr))"
                        : "repeat(auto-fill, minmax(140px, 1fr))",
                    }}
                  >
                    {g.tiles.map((t) => (
                      <MorningTileCard
                        key={`${t.setKey}-${t.platform}`}
                        tile={t}
                        onOpen={() => setOpenTile(t)}
                      />
                    ))}
                  </div>
                </div>
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
