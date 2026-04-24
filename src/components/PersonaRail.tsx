"use client";

import * as React from "react";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/personas";

/**
 * Horizontal avatar-first persona picker. Replaces the text-pill tab strips
 * for persona filtering on both Content Pipeline and Hook Analytics.
 *
 * Design intent (from the mobile UX mockup pass):
 * - 56px circular avatar (44px in compact variant) with serif initial
 * - Active: conic-gradient ring around the avatar + bold label underneath
 * - Optional leading "All" chip (rainbow gradient, star glyph)
 * - Count badge below the label, mono/9px
 * - Container horizontally scrolls with scroll-snap and hides native scrollbar
 *
 * Use on desktop too — the rail is intentionally compact; consumer branches
 * on isMobile for alternate (pill-strip) styling if needed.
 */
export function PersonaRail({
  current,
  onChange,
  counts,
  size = 56,
  includeAll = true,
  personaIds = PERSONA_IDS,
  style,
}: {
  current: "all" | PersonaId;
  onChange: (next: "all" | PersonaId) => void;
  counts?: Partial<Record<"all" | PersonaId, number>>;
  size?: number;
  includeAll?: boolean;
  personaIds?: readonly PersonaId[];
  style?: React.CSSProperties;
}) {
  const railRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-scroll the active item into view when selection changes so users can
  // always see which persona they just picked — critical when it was off the
  // right edge before the tap.
  React.useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const active = rail.querySelector<HTMLButtonElement>(
      "[data-persona-active='true']",
    );
    active?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [current]);

  const items: Array<{ id: "all" | PersonaId }> = [
    ...(includeAll ? [{ id: "all" as const }] : []),
    ...personaIds.map((pid) => ({ id: pid })),
  ];

  const labelSize = size >= 56 ? 11 : 11;
  const avatarFontSize = size >= 56 ? 20 : 16;

  return (
    <div
      ref={railRef}
      className="mobile-hscroll"
      style={{
        display: "flex",
        gap: size >= 56 ? 16 : 14,
        padding: "0 16px",
        overflowX: "auto",
        scrollSnapType: "x proximity",
        WebkitOverflowScrolling: "touch",
        ...style,
      }}
    >
      {items.map((t) => {
        const active = current === t.id;
        const persona = t.id === "all" ? null : PERSONAS[t.id];
        const count = counts?.[t.id];
        return (
          <button
            key={t.id}
            data-persona-active={active ? "true" : undefined}
            onClick={() => onChange(t.id)}
            type="button"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              padding: 0,
              flexShrink: 0,
              minWidth: Math.max(56, size + 4),
              scrollSnapAlign: "center",
              cursor: "pointer",
              // Mobile min-height rule from globals.css would otherwise force
              // these buttons to 44px; we control the height ourselves via the
              // avatar + label, so opt out with a min-height that covers both.
              minHeight: size + 24,
            }}
          >
            <div
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                padding: 3,
                background: active
                  ? "conic-gradient(from 180deg, var(--p-andrea), var(--p-emma), var(--p-olivia), var(--p-andrea))"
                  : "transparent",
                boxSizing: "border-box",
                transition: "background 160ms ease",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  background: persona
                    ? persona.color
                    : "linear-gradient(135deg, var(--p-andrea), var(--p-emma), var(--p-olivia))",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: avatarFontSize,
                  fontFamily: "var(--font-newsreader), Georgia, serif",
                  fontStyle: "italic",
                  fontWeight: 500,
                  border: active
                    ? "2px solid var(--surface)"
                    : "2px solid transparent",
                  boxShadow: active ? "none" : "var(--shadow-sm)",
                }}
              >
                {persona ? persona.name.charAt(0) : "✦"}
              </div>
            </div>
            <div
              style={{
                fontSize: labelSize,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--ink)" : "var(--ink-3)",
                letterSpacing: "-0.005em",
              }}
            >
              {persona ? persona.name : "All"}
            </div>
            {typeof count === "number" && count > 0 && (
              <div
                className="mono"
                style={{
                  fontSize: 9,
                  color: "var(--ink-4)",
                  marginTop: -2,
                  letterSpacing: "0.04em",
                }}
              >
                {count}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
