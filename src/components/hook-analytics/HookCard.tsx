"use client";

import * as React from "react";
import { Button, Chip, useCopy } from "../ui";
import { Icons } from "../Icons";
import { HOOK_CATEGORY_LABELS } from "@/lib/hook-categories";
import type { GeneratedHook, TikTokPost } from "@/lib/types";
import { PerformanceBadge } from "./PerformanceBadge";

export function HookCard({
  hook,
  linkedPost,
  onToggleUsed,
  onOpenCaption,
  onOpenInstagram,
}: {
  hook: GeneratedHook;
  linkedPost: TikTokPost | null;
  onToggleUsed: () => void;
  onOpenCaption: () => void;
  onOpenInstagram: () => void;
}) {
  const { copied, copy } = useCopy();
  const cat = (HOOK_CATEGORY_LABELS as Record<string, string>)[hook.category] ??
    hook.category;
  const [hover, setHover] = React.useState(false);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenCaption}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenCaption();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: 14,
        background: "var(--surface)",
        border: `1px solid ${hover ? "var(--ink-4)" : "var(--line-2)"}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity: hook.used ? 0.55 : 1,
        cursor: "pointer",
        transition: "border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease",
        boxShadow: hover ? "var(--shadow-sm)" : "none",
        transform: hover ? "translateY(-1px)" : "none",
      }}
    >
      <div
        className="serif"
        style={{
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 1.35,
          color: "var(--ink)",
          textDecoration: hook.used ? "line-through" : "none",
        }}
      >
        {hook.hookText}
      </div>
      {hook.rationale && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          {hook.rationale}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
          marginTop: 2,
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Chip tone="neutral" style={{ fontSize: 10 }}>
            {cat}
          </Chip>
          {linkedPost && (
            <PerformanceBadge
              performanceClass={linkedPost.performanceClass}
              ratio={linkedPost.performanceRatio}
              title={`Linked TikTok: ${linkedPost.viewCount.toLocaleString()} views (${
                linkedPost.performanceClass ?? "unlabeled"
              })`}
            />
          )}
        </span>
        <div
          style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
          onClick={stop}
        >
          <Button
            variant="ghost"
            size="sm"
            icon={<Icons.Sparkles />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenCaption();
            }}
            title="Generate TikTok caption from this hook"
          >
            TikTok
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icons.Sparkles />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenInstagram();
            }}
            title="Generate Instagram caption from this hook"
          >
            Instagram
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={copied ? <Icons.Check /> : <Icons.Copy />}
            onClick={(e) => {
              e.stopPropagation();
              copy(hook.hookText);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant={hook.used ? "secondary" : "ghost"}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggleUsed();
            }}
            title={hook.used ? "Mark unused" : "Mark used"}
          >
            {hook.used ? "Used" : "Mark used"}
          </Button>
        </div>
      </div>
    </div>
  );
}
