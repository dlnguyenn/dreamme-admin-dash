"use client";

import * as React from "react";

export function CharCount({ chars, limit }: { chars: number; limit: number }) {
  const pct = Math.min(chars / limit, 1.2);
  const over = chars > limit;
  const hue = over ? "var(--accent)" : pct > 0.9 ? "#d4a04a" : "var(--ink-3)";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: hue,
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 26 26"
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle cx="13" cy="13" r="10" fill="none" stroke="var(--line-2)" strokeWidth="2" />
        <circle
          cx="13"
          cy="13"
          r="10"
          fill="none"
          stroke={hue}
          strokeWidth="2"
          strokeDasharray={`${Math.min(pct, 1) * 62.83} 62.83`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 220ms ease" }}
        />
      </svg>
      <span>
        {chars.toLocaleString()}
        <span style={{ color: "var(--ink-4)" }}> / {limit.toLocaleString()}</span>
      </span>
    </div>
  );
}
