"use client";

import * as React from "react";
import { SPY_HASHTAGS } from "@/lib/spy-hashtags";
import { SPY_QUERIES } from "@/lib/spy-queries";
import { HOOK_CATEGORIES, HOOK_CATEGORY_LABELS, type HookCategory } from "@/lib/hook-categories";
import { SpyVideoCard } from "./SpyVideoCard";
import type { SpyVideoRow } from "./SpyTypes";

export type SortMode = "views" | "recent";
export type SourceTypeFilter = "all" | "hashtag" | "search";

export interface SpyFilters {
  source: string | "all"; // "all" | one of SPY_HASHTAGS | one of SPY_QUERIES
  sourceType: SourceTypeFilter;
  category: HookCategory | "all";
  viralOnly: boolean;
  sort: SortMode;
}

export function SpyVideoGrid({
  videos,
  loading,
  error,
  savedIds,
  filters,
  onFiltersChange,
  onCardClick,
  onToggleSave,
  emptyMessage,
}: {
  videos: SpyVideoRow[];
  loading: boolean;
  error: string | null;
  savedIds: Set<string>;
  filters: SpyFilters;
  onFiltersChange: (next: SpyFilters) => void;
  onCardClick: (v: SpyVideoRow) => void;
  onToggleSave: (v: SpyVideoRow) => void;
  emptyMessage?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filters */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 14,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
        }}
      >
        <FilterRow
          label="Source"
          options={[
            { id: "all", label: "All" },
            { id: "__type:hashtag", label: "Hashtags only" },
            { id: "__type:search", label: "Search only" },
          ]}
          active={
            filters.sourceType === "all" && filters.source === "all"
              ? "all"
              : filters.sourceType !== "all"
                ? `__type:${filters.sourceType}`
                : "all"
          }
          onChange={(id) => {
            if (id === "all") onFiltersChange({ ...filters, source: "all", sourceType: "all" });
            else if (id === "__type:hashtag")
              onFiltersChange({ ...filters, source: "all", sourceType: "hashtag" });
            else if (id === "__type:search")
              onFiltersChange({ ...filters, source: "all", sourceType: "search" });
          }}
        />
        <FilterRow
          label="Hashtag"
          options={[
            { id: "all", label: "All" },
            ...SPY_HASHTAGS.map((h) => ({ id: h, label: `#${h}` })),
          ]}
          active={
            filters.sourceType === "hashtag" || filters.sourceType === "all"
              ? SPY_HASHTAGS.includes(filters.source as (typeof SPY_HASHTAGS)[number])
                ? filters.source
                : "all"
              : "all"
          }
          onChange={(id) =>
            onFiltersChange({
              ...filters,
              source: id,
              sourceType: id === "all" ? filters.sourceType : "hashtag",
            })
          }
        />
        <FilterRow
          label="Search"
          options={[
            { id: "all", label: "All" },
            ...SPY_QUERIES.map((q) => ({ id: q, label: q })),
          ]}
          active={
            filters.sourceType === "search" || filters.sourceType === "all"
              ? (SPY_QUERIES as readonly string[]).includes(filters.source)
                ? filters.source
                : "all"
              : "all"
          }
          onChange={(id) =>
            onFiltersChange({
              ...filters,
              source: id,
              sourceType: id === "all" ? filters.sourceType : "search",
            })
          }
        />
        <FilterRow
          label="Category"
          options={[
            { id: "all", label: "All" },
            ...HOOK_CATEGORIES.map((c) => ({
              id: c,
              label: HOOK_CATEGORY_LABELS[c],
            })),
          ]}
          active={filters.category}
          onChange={(id) =>
            onFiltersChange({ ...filters, category: id as HookCategory | "all" })
          }
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={filters.viralOnly}
              onChange={(e) =>
                onFiltersChange({ ...filters, viralOnly: e.target.checked })
              }
            />
            Viral only
          </label>
          <div style={{ flex: 1 }} />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            Sort by
            <select
              value={filters.sort}
              onChange={(e) =>
                onFiltersChange({ ...filters, sort: e.target.value as SortMode })
              }
              style={{
                fontSize: 12,
                padding: "4px 8px",
                border: "1px solid var(--line)",
                borderRadius: 6,
                background: "var(--surface)",
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            >
              <option value="views">Views (high to low)</option>
              <option value="recent">Most recent</option>
            </select>
          </label>
        </div>
      </div>

      {/* Grid */}
      {error ? (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--accent)",
            borderRadius: 10,
            background: "color-mix(in oklab, var(--accent) 10%, transparent)",
            color: "var(--accent)",
            fontSize: 13,
          }}
        >
          Could not load spy videos — {error}
        </div>
      ) : loading ? (
        <div
          style={{
            padding: 24,
            border: "1px dashed var(--line-2)",
            borderRadius: 10,
            color: "var(--ink-4)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          Loading spy videos…
        </div>
      ) : videos.length === 0 ? (
        <div
          style={{
            padding: 24,
            border: "1px dashed var(--line-2)",
            borderRadius: 10,
            color: "var(--ink-4)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {emptyMessage ??
            "No videos match the current filters. Try widening the hashtag or category, or wait for the next 03:00 UTC scrape."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {videos.map((v) => (
            <SpyVideoCard
              key={v.id}
              video={v}
              saved={savedIds.has(v.id)}
              onClick={() => onCardClick(v)}
              onToggleSave={() => onToggleSave(v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  options,
  active,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--ink-4)",
          minWidth: 60,
        }}
      >
        {label}
      </span>
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              padding: "4px 10px",
              border: `1px solid ${isActive ? "var(--ink)" : "var(--line)"}`,
              borderRadius: 6,
              background: isActive ? "var(--ink)" : "transparent",
              color: isActive ? "var(--surface)" : "var(--ink-2)",
              fontSize: 11,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
