"use client";

/**
 * Growth AI · Inspo — viral SaaS/consumer-app content from TikTok +
 * Instagram (Motion's Inspo/Discover, but for organic virality). Browse
 * grid over viral_app_posts, trending-apps rollup, filters, a post
 * drawer with the AI's why-it-hit + "Adapt for DreamMe", and the
 * watchlist manager.
 */

import * as React from "react";
import { Sheet } from "../Sheet";
import { ConfirmDialog } from "../ConfirmDialog";
import { useToast } from "../ui";
import { useIsMobile } from "@/lib/useIsMobile";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/supabase";
import {
  fmtCompact,
  SectionLabel,
  TagChip,
  EmptyState,
  ErrorBanner,
  Skeleton,
} from "./shared";

// --- data --------------------------------------------------------------------

export interface InspoPost {
  id: string;
  platform: "tiktok" | "instagram";
  post_url: string;
  author_handle: string | null;
  app_name: string | null;
  app_category: string | null;
  by_brand: boolean | null;
  source: "watchlist" | "hashtag" | "search";
  posted_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  caption: string | null;
  thumbnail_url: string | null;
  hook_text: string | null;
  format: string | null;
  hook_type: string | null;
  why_it_hit: string | null;
}

interface WatchRow {
  id: string;
  platform: "tiktok" | "instagram";
  handle: string;
  app_name: string;
  category: string | null;
  active: boolean;
  last_result_count: number | null;
  last_scraped_at: string | null;
}

async function sb<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      ...(init?.method && init.method !== "GET" ? { Prefer: "return=minimal" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${init?.method ?? "GET"} failed: ${res.status}`);
  if (init?.method && init.method !== "GET") return undefined as T;
  return res.json() as Promise<T>;
}

function useInspoData() {
  const [posts, setPosts] = React.useState<InspoPost[]>([]);
  const [watchlist, setWatchlist] = React.useState<WatchRow[]>([]);
  const [favorites, setFavorites] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError(null);
        const [p, w, f] = await Promise.all([
          sb<InspoPost[]>(`viral_app_posts?select=*&order=view_count.desc&limit=1000`),
          sb<WatchRow[]>(`app_watchlist?select=*&order=app_name.asc&limit=400`),
          sb<Array<{ post_id: string }>>(`viral_app_favorites?select=post_id&limit=2000`),
        ]);
        if (!alive) return;
        setPosts(p);
        setWatchlist(w);
        setFavorites(new Set(f.map((x) => x.post_id)));
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  return { posts, watchlist, favorites, setFavorites, loading, error, refresh };
}

// --- main view -----------------------------------------------------------------

const VIEW_FLOORS = [
  { id: 50_000, label: "50K+" },
  { id: 100_000, label: "100K+" },
  { id: 500_000, label: "500K+" },
  { id: 1_000_000, label: "1M+" },
];

export function GrowthInspo({ onAsk }: { onAsk: (prompt: string) => void }) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const data = useInspoData();
  const [platform, setPlatform] = React.useState<"all" | "tiktok" | "instagram">("all");
  const [category, setCategory] = React.useState<string>("all");
  const [sourceFilter, setSourceFilter] = React.useState<"all" | "brand" | "discovered" | "saved">("all");
  const [floor, setFloor] = React.useState(50_000);
  const [sortBy, setSortBy] = React.useState<"views" | "recent">("views");
  const [openPost, setOpenPost] = React.useState<InspoPost | null>(null);
  const [watchlistOpen, setWatchlistOpen] = React.useState(false);

  const categories = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of data.posts) {
      const c = p.app_category ?? "other";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [data.posts]);

  const filtered = React.useMemo(() => {
    let out = data.posts.filter((p) => p.view_count >= floor);
    if (platform !== "all") out = out.filter((p) => p.platform === platform);
    if (category !== "all") out = out.filter((p) => (p.app_category ?? "other") === category);
    if (sourceFilter === "brand") out = out.filter((p) => p.source === "watchlist");
    else if (sourceFilter === "discovered") out = out.filter((p) => p.source !== "watchlist");
    else if (sourceFilter === "saved") out = out.filter((p) => data.favorites.has(p.id));
    if (sortBy === "recent") {
      out = [...out].sort((a, b) => ((a.posted_at ?? "") < (b.posted_at ?? "") ? 1 : -1));
    }
    return out;
  }, [data.posts, data.favorites, platform, category, sourceFilter, floor, sortBy]);

  const trending = React.useMemo(() => {
    const byApp = new Map<string, { app: string; posts: number; views: number; category: string }>();
    for (const p of data.posts) {
      if (!p.app_name || p.app_name === "Multiple (listicle)") continue;
      let t = byApp.get(p.app_name);
      if (!t) {
        t = { app: p.app_name, posts: 0, views: 0, category: p.app_category ?? "other" };
        byApp.set(p.app_name, t);
      }
      t.posts++;
      t.views += p.view_count;
    }
    return [...byApp.values()].sort((a, b) => b.views - a.views).slice(0, 10);
  }, [data.posts]);

  const toggleFavorite = async (post: InspoPost) => {
    const isFav = data.favorites.has(post.id);
    // optimistic
    data.setFavorites((cur) => {
      const next = new Set(cur);
      if (isFav) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
    try {
      if (isFav) {
        await sb(`viral_app_favorites?post_id=eq.${post.id}`, { method: "DELETE" });
      } else {
        await sb(`viral_app_favorites`, { method: "POST", body: JSON.stringify({ post_id: post.id }) });
      }
    } catch {
      toast("Couldn't save — try again");
      data.refresh();
    }
  };

  if (data.loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} h={300} radius={14} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {data.error && <ErrorBanner>{data.error}</ErrorBanner>}

      {/* ---- trending apps strip ---- */}
      {trending.length > 0 && (
        <>
          <SectionLabel
            right={
              <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
                {data.posts.length} viral posts tracked
              </span>
            }
          >
            Trending apps · by viral views
          </SectionLabel>
          <div
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              paddingBottom: 6,
              marginBottom: 22,
              scrollSnapType: "x proximity",
            }}
          >
            {trending.map((t, i) => (
              <button
                key={t.app}
                onClick={() =>
                  onAsk(
                    `"${t.app}" has ${t.posts} viral post${t.posts === 1 ? "" : "s"} (${fmtCompact(t.views)} combined views) in our viral-apps inspo feed. What are they doing right on organic social, and what should DreamMe steal from their playbook?`,
                  )
                }
                title="Ask the AI what they're doing right"
                style={{
                  flexShrink: 0,
                  scrollSnapAlign: "start",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px 10px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-sm)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  className="serif"
                  style={{ fontSize: 17, color: i < 3 ? "var(--ink)" : "var(--ink-3)", width: 18 }}
                >
                  {i + 1}
                </span>
                <span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t.app}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)", fontFamily: "var(--font-geist-mono), monospace" }}>
                    {fmtCompact(t.views)} views · {t.posts} post{t.posts === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- filters ---- */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <Pills
          options={[
            { id: "all", label: "All platforms" },
            { id: "tiktok", label: "TikTok" },
            { id: "instagram", label: "Instagram" },
          ]}
          value={platform}
          onChange={(v) => setPlatform(v as typeof platform)}
        />
        <Pills
          options={[
            { id: "all", label: "All sources" },
            { id: "brand", label: "Brand accounts" },
            { id: "discovered", label: "Discovered" },
            { id: "saved", label: `★ Saved${data.favorites.size ? ` ${data.favorites.size}` : ""}` },
          ]}
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
        />
        <Pills
          options={VIEW_FLOORS.map((f) => ({ id: String(f.id), label: f.label }))}
          value={String(floor)}
          onChange={(v) => setFloor(Number(v))}
        />
        <Pills
          options={[
            { id: "views", label: "Top views" },
            { id: "recent", label: "Recent" },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v as typeof sortBy)}
        />
        <button
          onClick={() => setWatchlistOpen(true)}
          style={{
            marginLeft: "auto",
            padding: "7px 14px",
            fontSize: 12.5,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink-2)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ⚙ Watchlist ({data.watchlist.filter((w) => w.active).length})
        </button>
      </div>

      {categories.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          <CategoryPill label="all" active={category === "all"} onClick={() => setCategory("all")} />
          {categories.map((c) => (
            <CategoryPill key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
          ))}
        </div>
      )}

      {/* ---- grid ---- */}
      {filtered.length === 0 ? (
        <EmptyState title="Nothing matches these filters.">
          Loosen the view floor or clear a filter — or run a scrape from the watchlist manager.
        </EmptyState>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 205}px, 1fr))`,
            gap: 14,
          }}
        >
          {filtered.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              isFavorite={data.favorites.has(p.id)}
              onOpen={() => setOpenPost(p)}
              onToggleFavorite={() => void toggleFavorite(p)}
            />
          ))}
        </div>
      )}

      {openPost && (
        <InspoDrawer
          post={openPost}
          isFavorite={data.favorites.has(openPost.id)}
          onToggleFavorite={() => void toggleFavorite(openPost)}
          onClose={() => setOpenPost(null)}
          onAsk={onAsk}
        />
      )}

      {watchlistOpen && (
        <WatchlistSheet
          watchlist={data.watchlist}
          onClose={() => setWatchlistOpen(false)}
          onChanged={data.refresh}
        />
      )}
    </div>
  );
}

// --- atoms ---------------------------------------------------------------------

function Pills({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 999,
              border: "1px solid",
              borderColor: active ? "var(--ink)" : "var(--line)",
              background: active ? "var(--ink)" : "var(--surface)",
              color: active ? "var(--surface)" : "var(--ink-2)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function CategoryPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 11px",
        fontSize: 11.5,
        borderRadius: 999,
        border: "1px solid",
        borderColor: active ? "var(--line-2)" : "var(--line)",
        background: active ? "var(--surface-2)" : "transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
        fontFamily: "var(--font-geist-mono), monospace",
      }}
    >
      {label.replace(/_/g, " ")}
    </button>
  );
}

function PlatformBadge({ platform }: { platform: "tiktok" | "instagram" }) {
  return (
    <span
      style={{
        padding: "3px 8px",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        borderRadius: 999,
        background: "rgba(26,24,22,0.78)",
        color: "#fff",
        backdropFilter: "blur(4px)",
      }}
    >
      {platform === "tiktok" ? "TikTok" : "IG Reel"}
    </span>
  );
}

// --- post card -------------------------------------------------------------------

function PostCard({
  post,
  isFavorite,
  onOpen,
  onToggleFavorite,
}: {
  post: InspoPost;
  isFavorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <article
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
      }}
      onClick={onOpen}
    >
      <div style={{ position: "relative", aspectRatio: "3 / 4", background: "var(--surface-2)" }}>
        {post.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.thumbnail_url}
            alt={post.hook_text ?? post.app_name ?? "viral post"}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-4)",
              fontSize: 11,
              padding: 12,
              textAlign: "center",
            }}
          >
            {post.hook_text || "no thumbnail"}
          </div>
        )}
        <div style={{ position: "absolute", top: 8, left: 8 }}>
          <PlatformBadge platform={post.platform} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          title={isFavorite ? "Unsave" : "Save to favorites"}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "none",
            background: "rgba(26,24,22,0.55)",
            color: isFavorite ? "#f5c95c" : "#fff",
            fontSize: 15,
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          {isFavorite ? "★" : "☆"}
        </button>
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            padding: "3px 9px",
            borderRadius: 999,
            background: "rgba(26,24,22,0.78)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            backdropFilter: "blur(4px)",
          }}
        >
          ▶ {fmtCompact(post.view_count)}
        </div>
      </div>

      <div style={{ padding: "10px 12px 12px", display: "grid", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={post.app_name ?? undefined}
          >
            {post.app_name ?? "Unknown app"}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--ink-4)", whiteSpace: "nowrap" }}>
            {post.posted_at ? new Date(post.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
          </span>
        </div>
        {post.hook_text && (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-2)",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            “{post.hook_text}”
          </div>
        )}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {post.format && <TagChip kind="format">{post.format.replace(/_/g, " ")}</TagChip>}
          {post.hook_type && <TagChip kind="hook">{post.hook_type}</TagChip>}
          {post.source !== "watchlist" && <TagChip kind="audience">discovered</TagChip>}
        </div>
      </div>
    </article>
  );
}

// --- drawer ---------------------------------------------------------------------

function InspoDrawer({
  post,
  isFavorite,
  onToggleFavorite,
  onClose,
  onAsk,
}: {
  post: InspoPost;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onAsk: (prompt: string) => void;
}) {
  const isMobile = useIsMobile();
  const adaptPrompt =
    `Adapt this viral ${post.platform === "tiktok" ? "TikTok" : "Instagram Reel"} for DreamMe's organic content:\n` +
    `- App: ${post.app_name ?? "unknown"} (${post.app_category ?? "?"}) · ${fmtCompact(post.view_count)} views\n` +
    `- Hook: "${post.hook_text || "(none visible)"}" · Format: ${post.format ?? "?"} · Hook type: ${post.hook_type ?? "?"}\n` +
    `- Why it hit: ${post.why_it_hit ?? "?"}\n` +
    `- Caption excerpt: ${(post.caption ?? "").slice(0, 300)}\n\n` +
    `Write the DreamMe version: 3 hook options adapted to the GLP-1 journey, a beat-by-beat outline in the same format, and which of our personas should post it.`;

  return (
    <Sheet open onClose={onClose} desktopMaxWidth={620} ariaLabel="Viral post details">
      <div style={{ display: "flex", gap: 18, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ flexShrink: 0, width: isMobile ? "100%" : 220 }}>
          {post.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbnail_url}
              alt="post cover"
              style={{
                width: isMobile ? 160 : 220,
                aspectRatio: "3 / 4",
                objectFit: "cover",
                borderRadius: 12,
                border: "1px solid var(--line)",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: isMobile ? 160 : 220,
                aspectRatio: "3 / 4",
                borderRadius: 12,
                border: "1px dashed var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-4)",
                fontSize: 12,
              }}
            >
              no thumbnail
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
            <span>▶ {fmtCompact(post.view_count)}</span>
            <span>♥ {fmtCompact(post.like_count)}</span>
            <span>💬 {fmtCompact(post.comment_count)}</span>
            {post.share_count > 0 && <span>↗ {fmtCompact(post.share_count)}</span>}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="serif" style={{ fontSize: 21, letterSpacing: "-0.01em" }}>
                {post.app_name ?? "Unknown app"}
              </span>
              <PlatformBadge platform={post.platform} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4, fontFamily: "var(--font-geist-mono), monospace" }}>
              @{post.author_handle ?? "?"} · {post.by_brand ? "brand account" : "creator/affiliate"} ·{" "}
              {post.posted_at ? new Date(post.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "date unknown"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {post.app_category && <TagChip kind="audience">{post.app_category.replace(/_/g, " ")}</TagChip>}
            {post.format && <TagChip kind="format">{post.format.replace(/_/g, " ")}</TagChip>}
            {post.hook_type && <TagChip kind="hook">{post.hook_type} hook</TagChip>}
          </div>

          {post.hook_text && (
            <div>
              <DrawerLabel>On-screen hook</DrawerLabel>
              <div className="serif" style={{ fontSize: 16, fontStyle: "italic", lineHeight: 1.4 }}>
                “{post.hook_text}”
              </div>
            </div>
          )}

          {post.why_it_hit && (
            <div>
              <DrawerLabel>Why it hit · AI</DrawerLabel>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{post.why_it_hit}</div>
            </div>
          )}

          {post.caption && (
            <div>
              <DrawerLabel>Caption</DrawerLabel>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  maxHeight: 110,
                  overflowY: "auto",
                  padding: "8px 10px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                }}
              >
                {post.caption}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button
              onClick={() => {
                onClose();
                onAsk(adaptPrompt);
              }}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                border: "1px solid var(--ink)",
                background: "var(--ink)",
                color: "var(--surface)",
                cursor: "pointer",
              }}
            >
              ✦ Adapt for DreamMe
            </button>
            <a
              href={post.post_url}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: "9px 16px",
                fontSize: 13,
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--ink-2)",
                textDecoration: "none",
              }}
            >
              Open post ↗
            </a>
            <button
              onClick={onToggleFavorite}
              style={{
                padding: "9px 14px",
                fontSize: 13,
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: isFavorite ? "var(--p-sarah)" : "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              {isFavorite ? "★ Saved" : "☆ Save"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function DrawerLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: "var(--ink-3)",
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

// --- watchlist manager -------------------------------------------------------------

function WatchlistSheet({
  watchlist,
  onClose,
  onChanged,
}: {
  watchlist: WatchRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [platform, setPlatform] = React.useState<"tiktok" | "instagram">("tiktok");
  const [handle, setHandle] = React.useState("");
  const [appName, setAppName] = React.useState("");
  const [categoryInput, setCategoryInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [scraping, setScraping] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<WatchRow | null>(null);
  const [discoveryOn, setDiscoveryOn] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;
    sb<Array<{ discovery_enabled: boolean }>>(`viral_app_settings?select=discovery_enabled&limit=1`)
      .then((rows) => {
        if (alive) setDiscoveryOn(rows[0]?.discovery_enabled ?? true);
      })
      .catch(() => {
        if (alive) setDiscoveryOn(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggleDiscovery = async () => {
    const next = !(discoveryOn ?? true);
    setDiscoveryOn(next); // optimistic
    try {
      await sb(`viral_app_settings?id=eq.true`, {
        method: "PATCH",
        body: JSON.stringify({ discovery_enabled: next, updated_at: new Date().toISOString() }),
      });
      toast(next ? "Discovery sweep on" : "Discovery sweep off — watchlist only");
    } catch {
      setDiscoveryOn(!next); // revert
      toast("Couldn't save — try again");
    }
  };

  const add = async () => {
    const h = handle.trim().replace(/^@/, "");
    if (!h || !appName.trim()) {
      toast("Handle and app name are required");
      return;
    }
    setBusy(true);
    try {
      await sb(`app_watchlist`, {
        method: "POST",
        body: JSON.stringify({
          platform,
          handle: h,
          app_name: appName.trim(),
          category: categoryInput.trim() || null,
        }),
      });
      setHandle("");
      setAppName("");
      toast(`Added @${h} — scraping…`);
      onChanged();
      // fire-and-forget first scrape for the new handle
      setScraping(h);
      void fetch("/api/growth/inspo/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handles: [h], platforms: [platform], include_discovery: false }),
      })
        .then(() => {
          toast(`@${h} scraped`);
          onChanged();
        })
        .catch(() => toast(`Scrape for @${h} failed — it'll retry on the next cron`))
        .finally(() => setScraping(null));
    } catch (e) {
      toast(`Add failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (w: WatchRow) => {
    try {
      await sb(`app_watchlist?id=eq.${w.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !w.active }),
      });
      onChanged();
    } catch {
      toast("Update failed");
    }
  };

  const remove = async (w: WatchRow) => {
    try {
      await sb(`app_watchlist?id=eq.${w.id}`, { method: "DELETE" });
      toast(`Removed @${w.handle}`);
      onChanged();
    } catch {
      toast("Delete failed");
    }
  };

  const grouped: Array<{ platform: "tiktok" | "instagram"; rows: WatchRow[] }> = [
    { platform: "tiktok", rows: watchlist.filter((w) => w.platform === "tiktok") },
    { platform: "instagram", rows: watchlist.filter((w) => w.platform === "instagram") },
  ];

  return (
    <Sheet open onClose={onClose} desktopMaxWidth={560} ariaLabel="Watchlist manager">
      <div className="serif" style={{ fontSize: 21, marginBottom: 4 }}>
        App watchlist
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 16px", lineHeight: 1.5 }}>
        Brand accounts scraped every Tue &amp; Fri. Repeated zeros in the result column mean a
        dead or wrong handle.
      </p>

      {/* discovery sweep toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 12,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          marginBottom: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Discovery sweep</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45, marginTop: 2 }}>
            Also scan hashtags &amp; keywords for viral apps beyond your watchlist. Off = watchlist
            accounts only (cheaper, less noise).
          </div>
        </div>
        <button
          role="switch"
          aria-checked={discoveryOn ?? true}
          disabled={discoveryOn === null}
          onClick={() => void toggleDiscovery()}
          title={discoveryOn ? "Turn discovery sweep off" : "Turn discovery sweep on"}
          style={{
            flexShrink: 0,
            width: 46,
            height: 26,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: discoveryOn ? "var(--accent-2)" : "var(--bg-2)",
            position: "relative",
            cursor: discoveryOn === null ? "default" : "pointer",
            opacity: discoveryOn === null ? 0.5 : 1,
            transition: "background 160ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: discoveryOn ? 22 : 2,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              boxShadow: "var(--shadow-sm)",
              transition: "left 160ms ease",
            }}
          />
        </button>
      </div>

      {/* add form */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          padding: "12px 14px",
          borderRadius: 12,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          marginBottom: 16,
        }}
      >
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as "tiktok" | "instagram")}
          style={{
            padding: "7px 10px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: 12.5,
          }}
        >
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
        </select>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@handle"
          style={inputStyle(110)}
        />
        <input
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
          placeholder="App name"
          style={inputStyle(120)}
        />
        <input
          value={categoryInput}
          onChange={(e) => setCategoryInput(e.target.value)}
          placeholder="category"
          style={inputStyle(100)}
        />
        <button
          onClick={() => void add()}
          disabled={busy}
          style={{
            padding: "7px 16px",
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid var(--ink)",
            background: busy ? "var(--surface-2)" : "var(--ink)",
            color: busy ? "var(--ink-4)" : "var(--surface)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Adding…" : "+ Add & scrape"}
        </button>
      </div>

      {grouped.map(({ platform: p, rows }) => (
        <div key={p} style={{ marginBottom: 16 }}>
          <DrawerLabel>
            {p === "tiktok" ? "TikTok" : "Instagram"} · {rows.filter((r) => r.active).length} active
          </DrawerLabel>
          <div style={{ display: "grid", gap: 4, maxHeight: 230, overflowY: "auto" }}>
            {rows.map((w) => {
              const dead = w.last_result_count === 0;
              return (
                <div
                  key={w.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    opacity: w.active ? 1 : 0.5,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong>@{w.handle}</strong>
                    <span style={{ color: "var(--ink-3)", marginLeft: 8 }}>{w.app_name}</span>
                    {scraping === w.handle && <span style={{ color: "var(--ink-4)", marginLeft: 8 }}>scraping…</span>}
                  </span>
                  {dead && (
                    <span
                      title="Last scrape returned 0 posts — dead or wrong handle"
                      style={{
                        fontSize: 9.5,
                        fontFamily: "var(--font-geist-mono), monospace",
                        padding: "2px 7px",
                        borderRadius: 999,
                        color: "var(--accent)",
                        background: "color-mix(in oklab, var(--accent) 12%, var(--surface))",
                        border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--line))",
                        whiteSpace: "nowrap",
                      }}
                    >
                      0 results
                    </span>
                  )}
                  <button
                    onClick={() => void toggleActive(w)}
                    title={w.active ? "Pause scraping" : "Resume scraping"}
                    style={{
                      fontSize: 11,
                      padding: "3px 9px",
                      borderRadius: 999,
                      border: "1px solid var(--line)",
                      background: "var(--surface-2)",
                      color: "var(--ink-3)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {w.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => setDeleting(w)}
                    title="Remove from watchlist"
                    style={{
                      fontSize: 12,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--line)",
                      background: "var(--surface)",
                      color: "var(--ink-4)",
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {deleting && (
        <ConfirmDialog
          title={`Remove @${deleting.handle}?`}
          message={`${deleting.app_name} (${deleting.platform}) stops being scraped. Existing posts stay in the feed.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            void remove(deleting);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Sheet>
  );
}

function inputStyle(width: number): React.CSSProperties {
  return {
    width,
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--surface)",
    color: "var(--ink)",
    fontSize: 12.5,
    outline: "none",
  };
}
