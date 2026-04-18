"use client";

import * as React from "react";
import { Icons } from "./Icons";
import type { Persona } from "@/lib/personas";

// -------- Chip --------

type ChipTone = "neutral" | "ink" | "accent" | "success";

export function Chip({
  children,
  tone = "neutral",
  style,
  onClick,
  title,
}: {
  children: React.ReactNode;
  tone?: ChipTone;
  style?: React.CSSProperties;
  onClick?: () => void;
  title?: string;
}) {
  const tones: Record<
    ChipTone,
    { bg: string; fg: string; border: string }
  > = {
    neutral: {
      bg: "var(--surface-2)",
      fg: "var(--ink-2)",
      border: "var(--line)",
    },
    ink: { bg: "var(--ink)", fg: "var(--surface)", border: "var(--ink)" },
    accent: {
      bg: "color-mix(in oklab, var(--accent) 12%, var(--surface))",
      fg: "var(--accent)",
      border: "color-mix(in oklab, var(--accent) 30%, var(--surface))",
    },
    success: {
      bg: "color-mix(in oklab, var(--p-olivia) 18%, var(--surface))",
      fg: "color-mix(in oklab, var(--p-olivia) 60%, var(--ink))",
      border: "color-mix(in oklab, var(--p-olivia) 35%, var(--surface))",
    },
  };
  const t = tones[tone];
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// -------- PersonaChip --------

export function PersonaChip({
  persona,
  size = "sm",
}: {
  persona: Persona;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: { h: 24, pad: "3px 8px 3px 3px", avatar: 18, font: 11 },
    md: { h: 30, pad: "4px 12px 4px 4px", avatar: 22, font: 12 },
    lg: { h: 36, pad: "5px 14px 5px 5px", avatar: 26, font: 13 },
  };
  const s = sizes[size];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: s.h,
        padding: s.pad,
        borderRadius: 999,
        background: persona.soft,
        color: "var(--ink)",
        border: `1px solid color-mix(in oklab, ${persona.color} 25%, var(--line))`,
        fontSize: s.font,
        fontWeight: 500,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      <span
        style={{
          width: s.avatar,
          height: s.avatar,
          borderRadius: "50%",
          background: persona.color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: s.avatar * 0.55,
        }}
      >
        {persona.avatar}
      </span>
      {persona.name}
    </span>
  );
}

// -------- Button --------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export function Button({
  children,
  variant = "secondary",
  size = "md",
  onClick,
  style,
  disabled,
  icon,
  title,
  type,
}: {
  children?: React.ReactNode;
  variant?: Variant;
  size?: Size;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
  icon?: React.ReactElement<{ size?: number }>;
  title?: string;
  type?: "button" | "submit" | "reset";
}) {
  const sizes: Record<Size, { pad: string; font: number; iconSize: number; gap: number }> = {
    sm: { pad: "6px 12px", font: 12, iconSize: 14, gap: 6 },
    md: { pad: "9px 14px", font: 13, iconSize: 16, gap: 8 },
    lg: { pad: "12px 18px", font: 14, iconSize: 18, gap: 10 },
  };
  const variants: Record<
    Variant,
    { bg: string; fg: string; border: string; hover: string }
  > = {
    primary: {
      bg: "var(--ink)",
      fg: "var(--surface)",
      border: "var(--ink)",
      hover: "var(--ink-2)",
    },
    secondary: {
      bg: "var(--surface)",
      fg: "var(--ink)",
      border: "var(--line-2)",
      hover: "var(--surface-2)",
    },
    ghost: {
      bg: "transparent",
      fg: "var(--ink-2)",
      border: "transparent",
      hover: "var(--surface-2)",
    },
    danger: {
      bg: "transparent",
      fg: "var(--accent)",
      border: "color-mix(in oklab, var(--accent) 30%, transparent)",
      hover: "color-mix(in oklab, var(--accent) 8%, var(--surface))",
    },
  };
  const s = sizes[size];
  const v = variants[variant];
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        padding: s.pad,
        fontSize: s.font,
        fontWeight: 500,
        background: hover && !disabled ? v.hover : v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        borderRadius: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 160ms ease, transform 120ms ease",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon && React.cloneElement(icon, { size: s.iconSize })}
      {children}
    </button>
  );
}

// -------- useCopy --------

export function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(t);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return { copied, copy };
}

// -------- Toasts --------

interface Toast {
  id: string;
  msg: string;
}
type ToastPush = (msg: string) => void;

const ToastCtx = React.createContext<ToastPush | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback<ToastPush>((msg) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      2400,
    );
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: "var(--ink)",
              color: "var(--surface)",
              padding: "10px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              boxShadow: "var(--shadow-lg)",
              animation: "fadeIn 200ms ease both",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icons.Check size={14} stroke="var(--surface)" />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastPush {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
