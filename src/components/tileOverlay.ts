/**
 * Shared styling for pills that sit ON TOP of slide artwork.
 *
 * Lives in its own module rather than in either consumer because
 * OurSlideshows renders SlideshowBatches — importing back the other way would
 * be a cycle. Deliberately not in porcelain.tsx either: that file's contract is
 * "every color comes from tokens, no literals here", and these two are
 * literals by necessity (see below).
 */
import type * as React from "react";

/**
 * Pills and scrims over slide artwork can't use surface tokens — the artwork
 * underneath is arbitrary colour, so a theme-aware background would vanish
 * against half the slides. These two are the design-specified exception, fixed
 * in both light and dark.
 */
export const OVERLAY_BG = "rgba(29,29,31,0.6)";
export const OVERLAY_FG = "#F5F5F7";

export const overlayPill: React.CSSProperties = {
  position: "absolute",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  font: "700 9.5px var(--font-ui)",
  letterSpacing: "0.03em",
  background: OVERLAY_BG,
  color: OVERLAY_FG,
  padding: "3px 7px",
  borderRadius: 99,
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  pointerEvents: "none",
};
