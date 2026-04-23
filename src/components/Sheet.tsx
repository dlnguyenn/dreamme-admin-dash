"use client";

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";

/**
 * Responsive modal wrapper.
 *
 * Desktop: centered card with configurable max-width, fixed-position,
 * fade-in animation — matches the existing modal idiom used by
 * ConfirmDialog / TransformationExportModal / BeforePhotoUploader.
 *
 * Mobile (≤640px): bottom sheet anchored to the bottom of the viewport,
 * full-width minus safe-area, rounded top corners, slides up from the
 * bottom, max-height 92vh so the top still peeks at whatever's behind it.
 *
 * Handles: backdrop click, ESC to close, body scroll lock while open,
 * respect of `open` prop for unmount control by the parent.
 *
 * The child is rendered unstyled inside an inner container the Sheet
 * controls (padding, background, border-radius). If you need edge-to-edge
 * content inside the sheet, pass `padded={false}` and handle padding
 * yourself.
 */
export function Sheet({
  open,
  onClose,
  desktopMaxWidth = 480,
  padded = true,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  desktopMaxWidth?: number;
  padded?: boolean;
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
    background: "color-mix(in oklab, var(--ink) 40%, transparent)",
    backdropFilter: "blur(2px)",
    WebkitBackdropFilter: "blur(2px)",
    zIndex: 200,
    animation: "fadeIn 160ms ease",
  };

  const desktopPanel: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 201,
    width: "94vw",
    maxWidth: desktopMaxWidth,
    maxHeight: "92vh",
    overflow: "auto",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 16,
    boxShadow: "var(--shadow-lg)",
    padding: padded ? "24px" : 0,
    animation: "fadeIn 180ms ease",
  };

  const mobilePanel: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 201,
    maxHeight: "92vh",
    overflow: "auto",
    background: "var(--surface)",
    borderTop: "1px solid var(--line)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    boxShadow: "var(--shadow-lg)",
    padding: padded ? "14px 16px 20px" : 0,
    paddingBottom: padded
      ? "calc(20px + env(safe-area-inset-bottom))"
      : "env(safe-area-inset-bottom)",
    animation: "sheetSlideUp 240ms cubic-bezier(.4,0,.2,1)",
  };

  return (
    <>
      <div onClick={onClose} style={backdrop} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={isMobile ? mobilePanel : desktopPanel}
      >
        {isMobile && padded && <DragHandle />}
        {children}
      </div>
    </>
  );
}

function DragHandle() {
  return (
    <div
      aria-hidden
      style={{
        width: 40,
        height: 4,
        borderRadius: 2,
        background: "var(--line-2)",
        margin: "0 auto 12px",
      }}
    />
  );
}
