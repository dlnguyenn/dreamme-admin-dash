"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, PersonaChip, useCopy, useToast } from "./ui";
import { Icons } from "./Icons";
import {
  HOOK_CATEGORIES,
  HOOK_CATEGORY_LABELS,
  type HookCategory,
} from "@/lib/hook-categories";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { HooksAPI } from "@/lib/hooks";
import type { GeneratedHook, TikTokPost } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { CaptionFromHookDrawer } from "./CaptionFromHookDrawer";

type Tab = "all" | PersonaId;
type Sort = "views" | "recent";

export function HookAnalytics() {
  const toast = useToast();
  const [posts, setPosts] = React.useState<TikTokPost[]>([]);
  const [generated, setGenerated] = React.useState<GeneratedHook[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("all");
  const [sort, setSort] = React.useState<Sort>("views");
  const [categoryFilter, setCategoryFilter] = React.useState<HookCategory | "all">(
    "all",
  );
  const [running, setRunning] = React.useState<"scrape" | "generate" | null>(null);
  const [generatingPersona, setGeneratingPersona] = React.useState<PersonaId | null>(null);
  const [captionHookId, setCaptionHookId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const data = await HooksAPI.fetchAll();
      setPosts(data.posts);
      setGenerated(data.generated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const runScrape = async () => {
    setRunning("scrape");
    try {
      const res = await fetch("/api/scrape/tiktok", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast(`Scraped ${json.upserted} posts (${json.ocred} new OCR)`);
      await refresh();
    } catch (e) {
      toast(`Scrape failed — ${(e as Error).message}`);
    } finally {
      setRunning(null);
    }
  };

  const runGeneratePersona = async (pid: PersonaId) => {
    setGeneratingPersona(pid);
    setRunning("generate");
    try {
      const res = await fetch("/api/generate/hooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perPersona: 2, personas: [pid] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast(`Generated ${json.generated} hooks for ${PERSONAS[pid].name}`);
      await refresh();
    } catch (e) {
      toast(`Generate failed — ${(e as Error).message}`);
    } finally {
      setGeneratingPersona(null);
      setRunning(null);
    }
  };

  const onToggleUsed = async (h: GeneratedHook) => {
    const next = !h.used;
    setGenerated((g) => g.map((x) => (x.id === h.id ? { ...x, used: next } : x)));
    try {
      await HooksAPI.markUsed(h.id, next);
    } catch (e) {
      toast(`Update failed — ${(e as Error).message}`);
      refresh();
    }
  };

  const filteredPosts = React.useMemo(() => {
    let arr = posts.filter((p) => p.firstSlideText.trim().length > 0);
    if (tab !== "all") arr = arr.filter((p) => p.personaId === tab);
    if (categoryFilter !== "all")
      arr = arr.filter((p) => p.category === categoryFilter);
    arr = arr.slice();
    if (sort === "views") arr.sort((a, b) => b.viewCount - a.viewCount);
    else
      arr.sort(
        (a, b) =>
          new Date(b.postedAt ?? b.createdAt).getTime() -
          new Date(a.postedAt ?? a.createdAt).getTime(),
      );
    return arr;
  }, [posts, tab, sort, categoryFilter]);

  const stats = React.useMemo(() => {
    const withHook = posts.filter((p) => p.firstSlideText);
    const totalViews = withHook.reduce((s, p) => s + p.viewCount, 0);
    const avgViews = withHook.length ? Math.round(totalViews / withHook.length) : 0;
    const byCat = new Map<string, number>();
    for (const p of withHook) {
      if (!p.category) continue;
      byCat.set(p.category, (byCat.get(p.category) ?? 0) + p.viewCount);
    }
    let topCat: HookCategory | null = null;
    let topCatViews = 0;
    for (const [cat, views] of byCat) {
      if (views > topCatViews) {
        topCat = cat as HookCategory;
        topCatViews = views;
      }
    }
    const weekAgo = Date.now() - 7 * 86400000;
    const thisWeek = generated.filter(
      (g) => new Date(g.createdAt).getTime() > weekAgo,
    ).length;
    return {
      posts: withHook.length,
      avgViews,
      topCat,
      thisWeek,
    };
  }, [posts, generated]);

  const tabs: Array<{ id: Tab; label: string; personaId: PersonaId | null }> = [
    { id: "all", label: "All", personaId: null },
    ...PERSONA_IDS.map((pid) => ({
      id: pid as Tab,
      label: PERSONAS[pid].name,
      personaId: pid,
    })),
  ];

  const genForPersona = (pid: PersonaId) =>
    generated.filter((g) => g.personaId === pid);

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard · 05"
        title={
          <>
            Hook <span style={{ fontStyle: "italic" }}>analytics</span>
          </>
        }
        subtitle="Scrapes the three TikTok accounts, OCRs the first-slide hook, categorizes it, and uses top performers to generate two new hooks per persona per day."
        tint="color-mix(in oklab, var(--p-emma) 40%, transparent)"
        actions={
          <>
            {error && (
              <Chip tone="accent" title={error}>
                Sync error
              </Chip>
            )}
            <Button
              variant="secondary"
              icon={<Icons.Search />}
              onClick={runScrape}
              disabled={running !== null}
            >
              {running === "scrape" ? "Scraping…" : "Scrape now"}
            </Button>
          </>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
        {[
          { label: "Posts analyzed", value: stats.posts.toLocaleString(), accent: null },
          {
            label: "Avg views / post",
            value: stats.avgViews.toLocaleString(),
            accent: null,
          },
          {
            label: "Top category",
            value: stats.topCat ? HOOK_CATEGORY_LABELS[stats.topCat] : "—",
            accent: "var(--p-emma)",
          },
          {
            label: "Hooks this week",
            value: stats.thisWeek.toLocaleString(),
            accent: "var(--p-olivia)",
          },
        ].map((s, i) => (
          <div key={i} style={{ background: "var(--surface)", padding: "18px 20px" }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "var(--ink-4)",
              }}
            >
              {s.label}
            </div>
            <div
              className="serif"
              style={{
                fontSize: 28,
                fontWeight: 400,
                letterSpacing: "-0.02em",
                marginTop: 4,
                color: s.accent || "var(--ink)",
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Today's generated hooks */}
      <section style={{ marginBottom: 40 }}>
        <SectionHeader
          title="Today's generated hooks"
          hint={`${generated.length} total · 2 per persona per day`}
        />
        {loading ? (
          <EmptyBlock>Loading…</EmptyBlock>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 18,
            }}
          >
            {PERSONA_IDS.map((pid) => (
              <div key={pid}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <PersonaChip persona={PERSONAS[pid]} size="sm" />
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ink-4)",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  >
                    {genForPersona(pid).length} hooks
                  </span>
                  <div style={{ flex: 1 }} />
                  <Button
                    variant="secondary"
                    icon={<Icons.Sparkles size={12} />}
                    onClick={() => runGeneratePersona(pid)}
                    disabled={running !== null}
                    title={`Generate hooks for ${PERSONAS[pid].name}`}
                  >
                    {generatingPersona === pid ? "Generating…" : "Generate"}
                  </Button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {genForPersona(pid)
                    .slice(0, 6)
                    .map((h) => (
                      <HookCard
                        key={h.id}
                        hook={h}
                        onToggleUsed={() => onToggleUsed(h)}
                        onOpenCaption={() => setCaptionHookId(h.id)}
                      />
                    ))}
                  {genForPersona(pid).length === 0 && (
                    <div
                      style={{
                        padding: 16,
                        fontSize: 12,
                        color: "var(--ink-4)",
                        border: "1px dashed var(--line-2)",
                        borderRadius: 10,
                        textAlign: "center",
                      }}
                    >
                      No hooks yet for {PERSONAS[pid].name}.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Top performing hooks */}
      <section>
        <SectionHeader
          title="Top performing hooks"
          hint={`${filteredPosts.length} of ${posts.length} posts`}
        />
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 18,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: 4,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: 10,
            }}
          >
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 7,
                    background: active ? "var(--surface)" : "transparent",
                    boxShadow: active ? "var(--shadow-sm)" : "none",
                    border: "none",
                    color: "var(--ink)",
                    fontSize: 12,
                    fontWeight: active ? 500 : 400,
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as HookCategory | "all")
            }
            style={{
              padding: "7px 10px",
              fontSize: 12,
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              borderRadius: 8,
              color: "var(--ink)",
            }}
          >
            <option value="all">All categories</option>
            {HOOK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {HOOK_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            style={{
              padding: "7px 10px",
              fontSize: 12,
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              borderRadius: 8,
              color: "var(--ink)",
            }}
          >
            <option value="views">Sort: Views</option>
            <option value="recent">Sort: Most recent</option>
          </select>
        </div>

        {filteredPosts.length === 0 ? (
          <EmptyBlock>
            No posts with hooks yet. Run <strong>Scrape now</strong> to pull them
            from Apify.
          </EmptyBlock>
        ) : (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
              background: "var(--surface)",
            }}
          >
            {filteredPosts.slice(0, 50).map((p, i) => (
              <PostRow key={p.id} post={p} rank={i + 1} />
            ))}
          </div>
        )}
      </section>

      {captionHookId && (() => {
        const target = generated.find((h) => h.id === captionHookId);
        if (!target) return null;
        return (
          <CaptionFromHookDrawer
            hook={target}
            onClose={() => setCaptionHookId(null)}
            onSaved={() => {
              setCaptionHookId(null);
              refresh();
            }}
          />
        );
      })()}
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 16,
      }}
    >
      <h2
        className="serif"
        style={{
          fontSize: 24,
          fontWeight: 400,
          letterSpacing: "-0.02em",
          margin: 0,
        }}
      >
        {title}
      </h2>
      {hint && (
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--ink-4)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: "center",
        color: "var(--ink-3)",
        border: "1px dashed var(--line-2)",
        borderRadius: 14,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function HookCard({
  hook,
  onToggleUsed,
  onOpenCaption,
}: {
  hook: GeneratedHook;
  onToggleUsed: () => void;
  onOpenCaption: () => void;
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
        }}
      >
        <Chip tone="neutral" style={{ fontSize: 10 }}>
          {cat}
        </Chip>
        <div style={{ display: "flex", gap: 6 }} onClick={stop}>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icons.Sparkles />}
            onClick={(e) => {
              e.stopPropagation();
              onOpenCaption();
            }}
            title="Generate caption from this hook"
          >
            Caption
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

function PostRow({ post, rank }: { post: TikTokPost; rank: number }) {
  const persona = PERSONAS[post.personaId];
  const cat = (HOOK_CATEGORY_LABELS as Record<string, string>)[post.category] ??
    post.category;
  return (
    <a
      href={post.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "grid",
        gridTemplateColumns: "38px 70px 1fr 140px 90px 140px",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        borderBottom: "1px solid var(--line)",
        textDecoration: "none",
        color: "var(--ink)",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--surface-2)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          color: "var(--ink-4)",
          textAlign: "right",
        }}
      >
        {rank.toString().padStart(2, "0")}
      </div>
      <div>
        {post.firstSlideUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={post.firstSlideUrl}
            alt=""
            style={{
              width: 54,
              height: 68,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: persona.soft,
            }}
          />
        ) : (
          <div
            style={{
              width: 54,
              height: 68,
              borderRadius: 6,
              background: persona.soft,
              border: "1px solid var(--line)",
            }}
          />
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          className="serif"
          style={{
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.35,
            marginBottom: 4,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {post.firstSlideText || <span style={{ color: "var(--ink-4)" }}>(no hook)</span>}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {formatRelative(post.postedAt ?? post.createdAt)}
        </div>
      </div>
      <div>
        <PersonaChip persona={persona} size="sm" />
      </div>
      <Chip tone="neutral" style={{ fontSize: 10 }}>
        {cat}
      </Chip>
      <div style={{ textAlign: "right" }}>
        <div
          className="serif"
          style={{
            fontSize: 20,
            fontWeight: 400,
            letterSpacing: "-0.01em",
          }}
        >
          {post.viewCount.toLocaleString()}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          views
        </div>
      </div>
    </a>
  );
}
