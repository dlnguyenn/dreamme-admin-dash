"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { SpyVideoGrid, type SpyFilters } from "./spy/SpyVideoGrid";
import { SpyVideoDrawer } from "./spy/SpyVideoDrawer";
import { SpyTrendsView } from "./spy/SpyTrendsView";
import type { SpyVideoRow } from "./spy/SpyTypes";

type SubtabId = "browse" | "trends" | "favorites";

const SUBTAB_KEY = "dreamme.spyTab";

const DEFAULT_FILTERS: SpyFilters = {
  hashtag: "all",
  category: "all",
  viralOnly: false,
  sort: "views",
};

export function SpyTool() {
  const [subtab, setSubtab] = React.useState<SubtabId>("browse");
  const [videos, setVideos] = React.useState<SpyVideoRow[]>([]);
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<SpyFilters>(DEFAULT_FILTERS);
  const [drawerVideo, setDrawerVideo] = React.useState<SpyVideoRow | null>(null);

  // Restore subtab from localStorage
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(SUBTAB_KEY);
      if (saved === "browse" || saved === "trends" || saved === "favorites") {
        setSubtab(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(SUBTAB_KEY, subtab);
    } catch {
      // ignore
    }
  }, [subtab]);

  // Load videos + favorites
  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.hashtag !== "all") params.set("hashtag", filters.hashtag);
      if (filters.category !== "all") params.set("category", filters.category);
      if (filters.viralOnly) params.set("viral_only", "true");
      params.set("sort", filters.sort);
      params.set("limit", "100");

      const [videosRes, favRes] = await Promise.all([
        fetch(`/api/spy/videos?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/spy/favorites`, { cache: "no-store" }),
      ]);
      const videosJson = (await videosRes.json()) as
        | { ok: true; rows: SpyVideoRow[] }
        | { ok: false; error: string };
      if (!videosRes.ok || !videosJson.ok) {
        throw new Error(("error" in videosJson && videosJson.error) || `HTTP ${videosRes.status}`);
      }
      setVideos(videosJson.rows);

      if (favRes.ok) {
        const favJson = (await favRes.json()) as
          | { ok: true; rows: Array<{ video_id: string }> }
          | { ok: false };
        if ("ok" in favJson && favJson.ok) {
          setSavedIds(new Set(favJson.rows.map((r) => r.video_id)));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const onToggleSave = async (v: SpyVideoRow) => {
    const isSaved = savedIds.has(v.id);
    // Optimistic
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(v.id);
      else next.add(v.id);
      return next;
    });
    try {
      await fetch("/api/spy/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: v.id, save: !isSaved }),
      });
    } catch {
      // revert on failure
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(v.id);
        else next.delete(v.id);
        return next;
      });
    }
  };

  const favoriteVideos = React.useMemo(
    () => videos.filter((v) => savedIds.has(v.id)),
    [videos, savedIds],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard · 09"
        title={
          <>
            Spy <span style={{ fontStyle: "italic" }}>tool</span>
          </>
        }
        subtitle="What's going viral in GLP-1 right now. Daily hashtag scrape into spy_videos. Browse hooks + first frames + view counts to inform your own content."
        tint="color-mix(in oklab, var(--p-emma) 35%, transparent)"
      />

      <SubtabNav
        active={subtab}
        onChange={setSubtab}
        counts={{
          browse: videos.length,
          favorites: savedIds.size,
        }}
      />

      {subtab === "browse" && (
        <SpyVideoGrid
          videos={videos}
          loading={loading}
          error={error}
          savedIds={savedIds}
          filters={filters}
          onFiltersChange={setFilters}
          onCardClick={setDrawerVideo}
          onToggleSave={onToggleSave}
        />
      )}

      {subtab === "favorites" && (
        <SpyVideoGrid
          videos={favoriteVideos}
          loading={loading}
          error={error}
          savedIds={savedIds}
          filters={filters}
          onFiltersChange={setFilters}
          onCardClick={setDrawerVideo}
          onToggleSave={onToggleSave}
          emptyMessage="No favorites yet. Click the bookmark on any spy video to save it for later."
        />
      )}

      {subtab === "trends" && <SpyTrendsView />}

      <SpyVideoDrawer
        open={drawerVideo !== null}
        video={drawerVideo}
        saved={drawerVideo ? savedIds.has(drawerVideo.id) : false}
        onClose={() => setDrawerVideo(null)}
        onToggleSave={() => drawerVideo && onToggleSave(drawerVideo)}
      />
    </div>
  );
}

function SubtabNav({
  active,
  onChange,
  counts,
}: {
  active: SubtabId;
  onChange: (id: SubtabId) => void;
  counts: { browse: number; favorites: number };
}) {
  const options: Array<{ id: SubtabId; label: string; count?: number }> = [
    { id: "browse", label: "Browse", count: counts.browse },
    { id: "trends", label: "Trends" },
    { id: "favorites", label: "Favorites", count: counts.favorites },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        marginBottom: 20,
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--surface)",
      }}
    >
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              fontSize: 12.5,
              fontFamily: "inherit",
              fontWeight: 500,
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              background: isActive ? "var(--ink)" : "transparent",
              color: isActive ? "var(--surface)" : "var(--ink-2)",
              transition: "background 140ms ease, color 140ms ease",
            }}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  background: isActive
                    ? "color-mix(in oklab, var(--surface) 25%, transparent)"
                    : "var(--surface-2)",
                  color: isActive ? "var(--surface)" : "var(--ink-4)",
                  borderRadius: 4,
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

