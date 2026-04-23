"use client";

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";

/**
 * Responsive drawer wrapper.
 *
 * Desktop: slides in from the left or right edge at a fixed width
 * (default 720px for right, 280px for left) — matches DetailDrawer.
 *
 * Mobile (≤640px): takes the full viewport and slides up from the bottom
 * for right-side drawers (detail / editor UX) or slides in from the left
 * for `side="left"` (matches the nav-drawer pattern).
 *
 * Callers supply their own inner padding and scroll behavior — the drawer
 * is a transparent container that just gives you a reliable animated,
 * dismissable, scroll-locked, ESC-handled surface.
 */
export function SideDrawer({
  open,
  onClose,
  side = "right",
  desktopWidth,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  desktopWidth?: number;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const backdrop: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "color-mix(in oklab, var(--ink) 30%, transparent)",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)",
    zIndex: 100,
    animation: "fadeIn 200ms ease",
  };

  const width = desktopWidth ?? (side === "right" ? 720 : 280);

  // Mobile: right-side drawers become full-screen slide-up panels; left-side
  // drawers stay left-anchored but take 86vw so the backdrop still peeks
  // through and creators know to tap to dismiss.
  const mobilePanel: React.CSSProperties = isMobile
    ? side === "right"
      ? {
          position: "fixed",
          inset: 0,
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          animation: "sheetSlideUp 280ms cubic-bezier(.4,0,.2,1)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }
      : {
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "86vw",
          maxWidth: 320,
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          boxShadow: "var(--shadow-drawer)",
          animation: "slideInLeft 260ms cubic-bezier(.4,0,.2,1)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }
    : {};

  const desktopPanel: React.CSSProperties =
    side === "right"
      ? {
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width,
          maxWidth: "92vw",
          background: "var(--surface)",
          boxShadow: "var(--shadow-drawer)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 280ms cubic-bezier(.4,0,.2,1)",
        }
      : {
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width,
          maxWidth: "92vw",
          background: "var(--surface)",
          boxShadow:
            "24px 0 48px rgba(26,24,22,0.12)" /* mirror of shadow-drawer */,
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          animation: "slideInLeft 280ms cubic-bezier(.4,0,.2,1)",
        };

  return (
    <>
      <div onClick={onClose} style={backdrop} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={isMobile ? mobilePanel : desktopPanel}
      >
        {children}
      </aside>
    </>
  );
}
