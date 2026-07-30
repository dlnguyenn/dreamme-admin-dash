"use client";

import * as React from "react";
import { Button } from "./ui";
import { Sheet } from "./Sheet";
import { useIsMobile } from "@/lib/useIsMobile";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * The confirmed action is in flight: both buttons and the Enter shortcut
   * lock so a second click/keypress can't fire the action again (a double
   * "Send this reply" once emailed a user twice).
   */
  busy?: boolean;
  /** confirm-button label while busy (defaults to confirmLabel + "…") */
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isMobile = useIsMobile();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !busy) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, busy]);

  return (
    <Sheet open={true} onClose={onCancel} desktopMaxWidth={420} ariaLabel={title}>
      <div
        className="serif"
        style={{
          fontSize: 22,
          fontWeight: 400,
          fontStyle: "italic",
          marginBottom: 8,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--ink-3)",
          marginBottom: 22,
        }}
      >
        {message}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column-reverse" : "row",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          style={isMobile ? { width: "100%", justifyContent: "center" } : undefined}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
          style={isMobile ? { width: "100%", justifyContent: "center" } : undefined}
        >
          {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
