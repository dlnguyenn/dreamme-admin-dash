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
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isMobile = useIsMobile();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm]);

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
          style={isMobile ? { width: "100%", justifyContent: "center" } : undefined}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          style={isMobile ? { width: "100%", justifyContent: "center" } : undefined}
        >
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
