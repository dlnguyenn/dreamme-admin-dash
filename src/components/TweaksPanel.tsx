"use client";

import * as React from "react";
import { Icons } from "./Icons";

export interface Tweaks {
  theme: "light" | "dark";
  gridSize: number;
}

export function TweaksPanel({
  tweaks,
  setTweaks,
  visible,
  onClose,
}: {
  tweaks: Tweaks;
  setTweaks: (t: Tweaks) => void;
  visible: boolean;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        width: 300,
        background: "color-mix(in oklab, var(--surface) 90%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--line-2)",
        borderRadius: 16,
        padding: 18,
        zIndex: 500,
        boxShadow: "var(--shadow-lg)",
        animation: "fadeIn 220ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: "var(--ink-3)",
          }}
        >
          Tweaks
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            padding: 4,
            display: "flex",
            cursor: "pointer",
          }}
        >
          <Icons.Close size={14} stroke="var(--ink-3)" />
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
          Theme
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "light" as const, label: "Light", icon: <Icons.Sun size={14} /> },
            { id: "dark" as const, label: "Dark", icon: <Icons.Moon size={14} /> },
          ].map((t) => {
            const active = tweaks.theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTweaks({ ...tweaks, theme: t.id })}
                style={{
                  flex: 1,
                  padding: "9px 10px",
                  background: active ? "var(--ink)" : "var(--surface-2)",
                  color: active ? "var(--surface)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ink)" : "var(--line-2)"}`,
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--ink-3)",
            marginBottom: 8,
          }}
        >
          <span>Cards per row</span>
          <span className="mono" style={{ color: "var(--ink-2)" }}>
            {tweaks.gridSize}
          </span>
        </div>
        <input
          type="range"
          min={2}
          max={6}
          step={1}
          value={tweaks.gridSize}
          onChange={(e) =>
            setTweaks({ ...tweaks, gridSize: parseInt(e.target.value, 10) })
          }
          style={{ width: "100%", accentColor: "var(--ink)" }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
            marginTop: 2,
          }}
        >
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
          <span>6</span>
        </div>
      </div>
    </div>
  );
}
