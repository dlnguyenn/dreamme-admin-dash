"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { PersonaChip } from "./ui";
import { useIsMobile } from "@/lib/useIsMobile";
import { formatTime } from "@/lib/format";
import type { Delivery } from "@/lib/types";
import type { Persona } from "@/lib/personas";

export function ContentCard({
  item,
  persona,
  onClick,
  onToggleStar,
  onCopyLink,
  onDelete,
  onTransform,
  selectionMode = false,
  selected = false,
}: {
  item: Delivery;
  persona: Persona;
  onClick: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
  onCopyLink: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onTransform?: (e: React.MouseEvent) => void;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  // On touch devices, hover never fires — reveal the action buttons
  // unconditionally so creators can reach them without a fake-hover tap.
  const showActions = hover || menuOpen || isMobile;
  // Touch targets bump up a notch on mobile (32 → 36) without blowing out
  // the card layout.
  const btnSize = isMobile ? 36 : 32;

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        borderRadius: 16,
        overflow: "hidden",
        cursor: "pointer",
        background: persona.soft,
        border: selected
          ? "2px solid var(--accent)"
          : "1px solid var(--line)",
        transition:
          "transform 220ms cubic-bezier(.4,0,.2,1), box-shadow 220ms ease",
        transform: hover && !selectionMode ? "translateY(-3px)" : "none",
        boxShadow: selected
          ? "0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent)"
          : hover
            ? "var(--shadow-md)"
            : "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          aspectRatio: "4/5",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transition: "transform 400ms ease",
            transform: hover ? "scale(1.03)" : "none",
          }}
        />
        {selectionMode && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: isMobile ? 32 : 28,
              height: isMobile ? 32 : 28,
              borderRadius: "50%",
              background: selected
                ? "var(--accent)"
                : "color-mix(in oklab, var(--surface) 85%, transparent)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: selected
                ? "2px solid var(--accent)"
                : "1px solid color-mix(in oklab, var(--line) 70%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: selected ? "var(--surface)" : "transparent",
              transition: "all 120ms ease",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {selected && <Icons.Check size={14} />}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            display: selectionMode ? "none" : "flex",
            gap: 6,
          }}
        >
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-label="More actions"
              style={{
                width: btnSize,
                height: btnSize,
                borderRadius: "50%",
                background:
                  "color-mix(in oklab, var(--surface) 80%, transparent)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border:
                  "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: showActions ? 1 : 0,
                transition: "opacity 160ms ease",
                cursor: "pointer",
              }}
            >
              <Icons.MoreVertical size={15} stroke="var(--ink-2)" />
            </button>
            {menuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: 38,
                  right: 0,
                  minWidth: 168,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  boxShadow: "var(--shadow-md)",
                  padding: 4,
                  zIndex: 10,
                  animation: "fadeIn 120ms ease",
                }}
              >
                <MenuItem
                  icon={<Icons.Link size={14} />}
                  label="Copy link"
                  onClick={(e) => {
                    setMenuOpen(false);
                    onCopyLink(e);
                  }}
                />
                <MenuItem
                  icon={<Icons.Trash size={14} />}
                  label="Delete"
                  destructive
                  onClick={(e) => {
                    setMenuOpen(false);
                    onDelete(e);
                  }}
                />
              </div>
            )}
          </div>
          <button
            onClick={onToggleStar}
            aria-label={item.starred ? "Unstar" : "Star"}
            style={{
              width: btnSize,
              height: btnSize,
              borderRadius: "50%",
              background:
                "color-mix(in oklab, var(--surface) 80%, transparent)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border:
                "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: showActions || item.starred ? 1 : 0,
              transition: "opacity 160ms ease",
              cursor: "pointer",
            }}
          >
            {item.starred ? (
              <Icons.StarFilled size={15} stroke="var(--accent)" />
            ) : (
              <Icons.Star size={15} stroke="var(--ink-2)" />
            )}
          </button>
          {onTransform && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTransform(e);
              }}
              aria-label="Download as transformation"
              title="Download as transformation"
              style={{
                width: btnSize,
                height: btnSize,
                borderRadius: "50%",
                background:
                  "color-mix(in oklab, var(--surface) 80%, transparent)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                border:
                  "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: showActions ? 1 : 0,
                transition: "opacity 160ms ease",
                cursor: "pointer",
              }}
            >
              <Icons.Swap size={15} stroke="var(--ink-2)" />
            </button>
          )}
        </div>
        {item.posted && !item.isBefore && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              padding: "3px 8px",
              borderRadius: 999,
              background:
                "color-mix(in oklab, var(--p-olivia) 40%, var(--surface))",
              color: "var(--ink)",
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              border:
                "1px solid color-mix(in oklab, var(--p-olivia) 50%, transparent)",
            }}
          >
            <Icons.Check size={10} /> Posted
          </div>
        )}
        {item.isBefore && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              padding: "3px 8px",
              borderRadius: 999,
              background: "color-mix(in oklab, var(--ink) 70%, transparent)",
              color: "var(--surface)",
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Before
          </div>
        )}
      </div>
      <div style={{ padding: "12px 14px 14px", background: "var(--surface)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <PersonaChip persona={persona} size="sm" />
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {formatTime(item.createdAt)}
          </span>
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--ink-3)",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontStyle: item.isBefore ? "italic" : "normal",
          }}
        >
          {item.isBefore
            ? `Before photo · ${item.caption?.trim() || "transformation asset"}`
            : `${item.caption.slice(0, 160)}…`}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  destructive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        border: "none",
        background: hover
          ? destructive
            ? "color-mix(in oklab, var(--accent) 10%, var(--surface))"
            : "var(--surface-2)"
          : "transparent",
        color: destructive ? "var(--accent)" : "var(--ink)",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
