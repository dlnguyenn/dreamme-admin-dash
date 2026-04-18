"use client";

import * as React from "react";
import { Icons } from "./Icons";
import { PersonaChip } from "./ui";
import { formatTime } from "@/lib/format";
import type { Delivery } from "@/lib/types";
import type { Persona } from "@/lib/personas";

export function ContentCard({
  item,
  persona,
  onClick,
  onToggleStar,
}: {
  item: Delivery;
  persona: Persona;
  onClick: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = React.useState(false);
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
        border: "1px solid var(--line)",
        transition:
          "transform 220ms cubic-bezier(.4,0,.2,1), box-shadow 220ms ease",
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-sm)",
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
        <button
          onClick={onToggleStar}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 32,
            height: 32,
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
            opacity: hover || item.starred ? 1 : 0,
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
        {item.posted && (
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
          }}
        >
          {item.caption.slice(0, 160)}…
        </div>
      </div>
    </div>
  );
}
