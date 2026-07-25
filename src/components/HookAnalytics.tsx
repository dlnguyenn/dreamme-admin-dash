"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, PersonaChip, useCopy, useToast } from "./ui";
import { Icons } from "./Icons";
import { Card, CategoryTag, SectionHeader, StatStrip } from "./porcelain";
import {
  HOOK_CATEGORIES,
  HOOK_CATEGORY_LABELS,
  type HookCategory,
} from "@/lib/hook-categories";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { FatiguePanel } from "./hook-analytics/FatiguePanel";
import { CategoryHeatStrip } from "./hook-analytics/CategoryHeatStrip";
import { HookCard } from "./hook-analytics/HookCard";
import { HookBankDrawer } from "./hook-analytics/HookBankDrawer";
import { SUPABASE_ANON, SUPABASE_URL } from "@/lib/supabase";
import { HooksAPI } from "@/lib/hooks";
import type { GeneratedHook, TikTokPost } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { CaptionFromHookDrawer } from "./CaptionFromHookDrawer";
import { InstagramCaptionDialog } from "./InstagramCaptionDialog";
import { PersonaRail } from "./PersonaRail";
import { useIsMobile } from "@/lib/useIsMobile";

type Tab = "all" | PersonaId;
type Sort = "views" | "recent";

export function HookAnalytics() {
  const toast = useToast();
  const isMobile = useIsMobile();
  const [posts, setPosts] = React.useState<TikTokPost[]>([]);
  const [generated, setGenerated] = React.useState<GeneratedHook[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("all");
  // Mobile-only: split the screen into two sub-segments so stats + generated
  // hooks + top posts don't all compete for <400px of height.
  const [sub, setSub] = React.useState<"generated" | "top">("generated");
  const [sort, setSort] = React.useState<Sort>("views");
  const [categoryFilter, setCategoryFilter] = React.useState<HookCategory | "all">(
    "all",
  );
  const [running, setRunning] = React.useState<"scrape" | "generate" | null>(null);
  const [generatingPersona, setGeneratingPersona] = React.useState<PersonaId | null>(null);
  const [captionHookId, setCaptionHookId] = React.useState<string | null>(null);
  const [igHookId, setIgHookId] = React.useState<string | null>(null);
  const [bankPersona, setBankPersona] = React.useState<PersonaId | null>(null);

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

  // Top view count in the current filter — drives the relative hold bars.
  const maxViews = React.useMemo(
    () => filteredPosts.reduce((m, p) => Math.max(m, p.viewCount), 1),
    [filteredPosts],
  );

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

  const postsById = React.useMemo(() => {
    const m = new Map<string, TikTokPost>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

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

  // Persona counts used by the mobile PersonaRail — same shape PersonaRail
  // expects in ContentPipeline (counts.all + per-persona).
  const mobilePersonaCounts = React.useMemo(() => {
    const c: Partial<Record<"all" | PersonaId, number>> = {
      all: sub === "generated" ? generated.length : posts.length,
    };
    PERSONA_IDS.forEach((pid) => {
      c[pid] =
        sub === "generated"
          ? generated.filter((g) => g.personaId === pid).length
          : posts.filter((p) => p.personaId === pid).length;
    });
    return c;
  }, [sub, generated, posts]);

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Content"
        title="Hook Analytics"
        subtitle="Scrapes the tracked TikTok accounts, OCRs the first-slide hook, categorizes it, and uses top performers to generate two new hooks per persona per day."
        actions={
          <>
            {error && (
              <Chip tone="danger" title={error}>
                Sync error
              </Chip>
            )}
            <Button
              variant="secondary"
              icon={<Icons.Refresh />}
              onClick={refresh}
              disabled={loading}
            >
              Refresh
            </Button>
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

      {(() => {
        const kpis = [
          { label: "Posts analyzed", value: stats.posts.toLocaleString() },
          { label: "Avg views / post", value: stats.avgViews.toLocaleString() },
          {
            label: "Top category",
            value: stats.topCat ? HOOK_CATEGORY_LABELS[stats.topCat] : "—",
          },
          { label: "Hooks this week", value: stats.thisWeek.toLocaleString() },
        ];
        if (isMobile) {
          // Horizontal-scroll KPI strip: 2 wide cards visible, rest peek off
          // the right edge. Cleaner than a squashed 4-up grid.
          return (
            <div
              className="mobile-hscroll"
              style={{
                margin: "0 -16px 16px",
                padding: "4px 16px 10px",
                display: "flex",
                gap: 10,
                overflowX: "auto",
                scrollSnapType: "x proximity",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {kpis.map((s, i) => (
                <div
                  key={i}
                  style={{
                    flexShrink: 0,
                    minWidth: 150,
                    padding: "14px 16px",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 16,
                    boxShadow: "var(--shadow-card)",
                    scrollSnapAlign: "start",
                  }}
                >
                  <div
                    style={{
                      font: "650 10.5px var(--font-ui)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--ink-3)",
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      font: "700 22px/1.1 var(--font-ui)",
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-0.01em",
                      marginTop: 6,
                      color: "var(--ink)",
                    }}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div style={{ marginBottom: 28 }}>
            <StatStrip stats={kpis} />
          </div>
        );
      })()}

      {isMobile && (
        <>
          {/* Segmented sub-nav: Generated vs Top posts. Split the two mental
              models so stats + persona rail + list don't stack endlessly. */}
          <div
            role="tablist"
            aria-label="Section"
            style={{
              display: "flex",
              padding: 4,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              marginBottom: 14,
            }}
          >
            {(
              [
                { id: "generated" as const, label: "Generated", count: generated.length },
                { id: "top" as const, label: "Top posts", count: posts.length },
              ]
            ).map((s) => {
              const active = sub === s.id;
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSub(s.id)}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 7,
                    background: active ? "var(--surface)" : "transparent",
                    boxShadow: active ? "var(--shadow-xs)" : "none",
                    color: active ? "var(--ink)" : "var(--ink-3)",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: active ? 650 : 500,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  {s.label}
                  <span
                    style={{
                      font: "650 10.5px var(--font-ui)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ink-4)",
                      padding: "1px 6px",
                      background: active ? "var(--bg-2)" : "transparent",
                      borderRadius: 999,
                    }}
                  >
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Persona rail (avatar-first). Edge-to-edge — negative margin
              counters the main 16px gutter. */}
          <div style={{ margin: "0 -16px 18px" }}>
            <PersonaRail
              current={tab}
              onChange={(next) => setTab(next as Tab)}
              counts={mobilePersonaCounts}
              includeAll
            />
          </div>
        </>
      )}

      {/* Today's generated hooks */}
      {(!isMobile || sub === "generated") && (
      <section style={{ marginBottom: 40 }}>
        {!isMobile && (
          <SectionHeader
            family="accent"
            icon="Spark"
            title="Today's generated hooks"
            meta={`${generated.length} total · 2 per persona per day`}
            style={{ marginTop: 0 }}
          />
        )}
        {loading ? (
          <EmptyBlock>Loading…</EmptyBlock>
        ) : isMobile ? (
          // Mobile: one persona at a time (driven by the PersonaRail selection).
          // "all" shows everyone stacked. Each hook card is full-width.
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {(tab === "all" ? PERSONA_IDS : [tab as PersonaId]).map((pid) => {
              const pHooks = genForPersona(pid);
              const pUnused = pHooks.filter((h) => !h.used);
              const pVisible = pUnused.slice(0, 2);
              const pBankCount = pHooks.length - pVisible.length;
              if (tab !== "all" && pHooks.length === 0) return (
                <EmptyBlock key={pid}>
                  No hooks yet for {PERSONAS[pid].name}.
                </EmptyBlock>
              );
              if (pHooks.length === 0) return null;
              return (
                <div key={pid}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ font: "650 15px var(--font-ui)", color: "var(--ink)" }}>
                      {PERSONAS[pid].name}&apos;s hooks
                    </div>
                    <span
                      style={{
                        font: "400 11px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ink-4)",
                      }}
                      title={`${pUnused.length} unused · ${pHooks.length - pUnused.length} used`}
                    >
                      {pUnused.length} active · {pBankCount} in bank
                    </span>
                    <div style={{ flex: 1 }} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setBankPersona(pid)}
                      disabled={pHooks.length === 0}
                    >
                      Bank
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Icons.Sparkles size={12} />}
                      onClick={() => runGeneratePersona(pid)}
                      disabled={running !== null}
                    >
                      {generatingPersona === pid ? "…" : "Generate"}
                    </Button>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    {pVisible.length > 0 ? (
                      pVisible.map((h) => (
                        <HookCard
                          key={h.id}
                          hook={h}
                          linkedPost={
                            h.postedPostId ? postsById.get(h.postedPostId) ?? null : null
                          }
                          onToggleUsed={() => onToggleUsed(h)}
                          onOpenCaption={() => setCaptionHookId(h.id)}
                          onOpenInstagram={() => setIgHookId(h.id)}
                        />
                      ))
                    ) : (
                      <EmptyBlock>
                        No active hooks for {PERSONAS[pid].name}. Generate to see candidates.
                      </EmptyBlock>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 18,
            }}
          >
            {PERSONA_IDS.map((pid) => {
              const all = genForPersona(pid);
              const unused = all.filter((h) => !h.used);
              const visible = unused.slice(0, 2);
              const bankCount = all.length - visible.length;
              return (
              <div key={pid} style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    minWidth: 0,
                    flexWrap: "wrap",
                  }}
                >
                  <PersonaChip persona={PERSONAS[pid]} size="sm" />
                  <span
                    style={{
                      font: "400 11px var(--font-ui)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ink-4)",
                    }}
                    title={`${unused.length} unused · ${all.length - unused.length} used · ${all.length} total`}
                  >
                    {unused.length} active · {bankCount} in bank
                  </span>
                  <div style={{ flex: 1 }} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBankPersona(pid)}
                    disabled={all.length === 0}
                    title={`Open ${PERSONAS[pid].name}'s hook bank`}
                  >
                    Bank
                  </Button>
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
                <div style={{ marginBottom: 10 }}>
                  <CategoryHeatStrip persona={pid} posts={posts} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {visible.length > 0 ? (
                    visible.map((h) => (
                      <HookCard
                        key={h.id}
                        hook={h}
                        linkedPost={
                          h.postedPostId ? postsById.get(h.postedPostId) ?? null : null
                        }
                        onToggleUsed={() => onToggleUsed(h)}
                        onOpenCaption={() => setCaptionHookId(h.id)}
                        onOpenInstagram={() => setIgHookId(h.id)}
                      />
                    ))
                  ) : (
                    <div
                      style={{
                        padding: 16,
                        fontSize: 12,
                        color: "var(--ink-4)",
                        border: "1px dashed var(--line-2)",
                        borderRadius: 10,
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <span>
                        {all.length === 0
                          ? `No hooks yet for ${PERSONAS[pid].name}.`
                          : `No active hooks for ${PERSONAS[pid].name}.`}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Icons.Sparkles size={12} />}
                        onClick={() => runGeneratePersona(pid)}
                        disabled={running !== null}
                      >
                        {generatingPersona === pid ? "Generating…" : "Generate now"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Hook family fatigue */}
      {!isMobile && (
        <section style={{ marginBottom: 40 }}>
          <SectionHeader
            family="warning"
            icon="TriAlert"
            title="Fatigued hook families"
            meta="In cooldown — generator avoids these"
            style={{ marginTop: 0 }}
          />
          <FatiguePanel supabaseUrl={SUPABASE_URL} supabaseAnon={SUPABASE_ANON} />
        </section>
      )}

      {/* Top performing hooks */}
      {(!isMobile || sub === "top") && (
      <section>
        {!isMobile && (
          <SectionHeader
            family="accent"
            icon="Music"
            title="Top performing hooks"
            meta={`${filteredPosts.length} of ${posts.length} posts`}
            style={{ marginTop: 0 }}
          />
        )}
        {!isMobile && (
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
                    borderRadius: 9,
                    background: active ? "var(--surface)" : "transparent",
                    boxShadow: active ? "var(--shadow-xs)" : "none",
                    border: "none",
                    color: active ? "var(--ink)" : "var(--ink-2)",
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    fontWeight: active ? 650 : 500,
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
        )}

        {/* Mobile-only compact sort/category row (selects only, no pill
            strip — persona rail above already handles persona filtering). */}
        {isMobile && (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as HookCategory | "all")
              }
              style={{
                flex: 1,
                minWidth: 140,
                padding: "9px 12px",
                fontSize: 13,
                background: "var(--surface)",
                border: "1px solid var(--line-2)",
                borderRadius: 10,
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
                padding: "9px 12px",
                fontSize: 13,
                background: "var(--surface)",
                border: "1px solid var(--line-2)",
                borderRadius: 10,
                color: "var(--ink)",
              }}
            >
              <option value="views">Views</option>
              <option value="recent">Recent</option>
            </select>
          </div>
        )}

        {filteredPosts.length === 0 ? (
          <EmptyBlock>
            No posts with hooks yet. Run <strong>Scrape now</strong> to pull them
            from Apify.
          </EmptyBlock>
        ) : isMobile ? (
          // Mobile: stacked full-width rows, thumb + hook + meta. Grid
          // columns on <390px are unusable.
          <div
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {filteredPosts.slice(0, 50).map((p) => (
              <MobilePostRow key={p.id} post={p} />
            ))}
          </div>
        ) : (
          <Card pad={0} style={{ overflow: "hidden" }}>
            {filteredPosts.slice(0, 50).map((p, i) => (
              <PostRow key={p.id} post={p} rank={i + 1} maxViews={maxViews} />
            ))}
          </Card>
        )}
      </section>
      )}

      <HookBankDrawer
        open={bankPersona !== null}
        persona={bankPersona}
        hooks={generated}
        postsById={postsById}
        onClose={() => setBankPersona(null)}
        onToggleUsed={(h) => onToggleUsed(h)}
        onOpenCaption={(h) => {
          setBankPersona(null);
          setCaptionHookId(h.id);
        }}
        onOpenInstagram={(h) => {
          setBankPersona(null);
          setIgHookId(h.id);
        }}
      />

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

      {igHookId && (() => {
        const target = generated.find((h) => h.id === igHookId);
        if (!target) return null;
        return (
          <InstagramCaptionDialog
            open={true}
            onClose={() => setIgHookId(null)}
            personaId={target.personaId}
            seedHookText={target.hookText}
            sourceHookId={target.id}
            seedPreview={target.hookText}
            onSaved={() => {
              setIgHookId(null);
              refresh();
            }}
          />
        );
      })()}
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
        borderRadius: 12,
        font: "400 13px var(--font-ui)",
      }}
    >
      {children}
    </div>
  );
}


function PostRow({
  post,
  rank,
  maxViews,
}: {
  post: TikTokPost;
  rank: number;
  maxViews: number;
}) {
  const persona = PERSONAS[post.personaId];
  const cat = (HOOK_CATEGORY_LABELS as Record<string, string>)[post.category] ??
    post.category;
  // Views relative to the top post in the current filter — semantic bar color.
  const share = Math.min(1, post.viewCount / Math.max(1, maxViews));
  const barFill =
    share >= 0.7
      ? "var(--success)"
      : share >= 0.5
        ? "var(--accent)"
        : "var(--warning)";
  const pctColor =
    share >= 0.7
      ? "var(--success-text)"
      : share >= 0.5
        ? "var(--accent-text)"
        : "var(--warning-text)";
  return (
    <a
      href={post.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "grid",
        gridTemplateColumns: "24px 70px minmax(0, 1fr) 130px 150px 96px",
        alignItems: "center",
        gap: 14,
        padding: "13px 18px",
        borderTop: rank > 1 ? "1px solid var(--line)" : "none",
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
          font: "700 13px var(--font-ui)",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink-4)",
          textAlign: "right",
        }}
      >
        {rank}
      </div>
      <div>
        {post.firstSlideUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={post.firstSlideUrl}
            alt=""
            loading="lazy"
            decoding="async"
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
          style={{
            font: "600 13.5px/1.4 var(--font-ui)",
            color: "var(--ink)",
            marginBottom: 5,
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
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <CategoryTag family="neutral" size={9.5}>
            {cat.toUpperCase()}
          </CategoryTag>
          <span
            style={{
              font: "400 12px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ink-4)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {formatRelative(post.postedAt ?? post.createdAt)}
          </span>
        </div>
      </div>
      <div>
        <PersonaChip persona={persona} size="sm" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            borderRadius: 99,
            background: "var(--bg-2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${(share * 100).toFixed(0)}%`,
              height: "100%",
              borderRadius: 99,
              background: barFill,
            }}
          />
        </div>
        <span
          style={{
            font: "650 13px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: pctColor,
            width: 42,
            textAlign: "right",
            flex: "none",
          }}
        >
          {(share * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            font: "650 15px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
            color: "var(--ink)",
          }}
        >
          {post.viewCount.toLocaleString()}
        </div>
        <div
          style={{
            font: "500 10px var(--font-ui)",
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          views
        </div>
      </div>
    </a>
  );
}

/** Mobile-only list row for top-performing posts. Full-width, stacked —
 *  no 6-column grid competing for <400px of horizontal space. */
function MobilePostRow({ post }: { post: TikTokPost }) {
  const persona = PERSONAS[post.personaId];
  const cat =
    (HOOK_CATEGORY_LABELS as Record<string, string>)[post.category] ??
    post.category;
  return (
    <a
      href={post.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        gap: 12,
        padding: 12,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        textDecoration: "none",
        color: "var(--ink)",
      }}
    >
      {post.firstSlideUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={post.firstSlideUrl}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: 64,
            height: 80,
            flexShrink: 0,
            objectFit: "cover",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: persona.soft,
          }}
        />
      ) : (
        <div
          style={{
            width: 64,
            height: 80,
            flexShrink: 0,
            borderRadius: 8,
            background: persona.soft,
            border: "1px solid var(--line)",
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            font: "600 13.5px/1.4 var(--font-ui)",
            color: "var(--ink)",
            marginBottom: 6,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
          }}
        >
          {post.firstSlideText || (
            <span style={{ color: "var(--ink-4)" }}>(no hook)</span>
          )}
        </div>
        <div style={{ flex: 1 }} />
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
              font: "700 9.5px var(--font-ui)",
              padding: "2px 7px",
              borderRadius: 6,
              background: "var(--bg-2)",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {cat}
          </span>
          <span
            style={{
              font: "400 11px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ink-4)",
            }}
          >
            {persona.name} · {formatRelative(post.postedAt ?? post.createdAt)}
          </span>
          <div style={{ flex: 1 }} />
          <span
            style={{
              font: "650 15px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
              color: "var(--ink)",
            }}
          >
            {formatViewCount(post.viewCount)}
          </span>
        </div>
      </div>
    </a>
  );
}

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}
