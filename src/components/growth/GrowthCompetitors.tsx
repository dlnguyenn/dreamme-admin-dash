"use client";

/**
 * Growth AI · Competitors — track competitors' Meta Ad Library ads.
 * Type a brand name → resolve their Meta page → pull + AI-analyze every
 * ad → monitor for new launches on the Tue/Fri cadence (NEW badges).
 */

import * as React from "react";
import { Sheet } from "../Sheet";
import { ConfirmDialog } from "../ConfirmDialog";
import { useToast } from "../ui";
import { useIsMobile } from "@/lib/useIsMobile";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/supabase";
import { SectionLabel, TagChip, EmptyState, ErrorBanner, Skeleton } from "./shared";

// --- data --------------------------------------------------------------------

interface CompetitorBrand {
  id: string;
  page_id: string;
  page_name: string;
  brand_name: string | null;
  category: string | null;
  active: boolean;
  last_scraped_at: string | null;
  last_ad_count: number | null;
  new_last_scrape: number | null;
}

interface CompetitorAd {
  id: string;
  ad_archive_id: string;
  page_id: string;
  page_name: string | null;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  body: string | null;
  title: string | null;
  cta_text: string | null;
  cta_type: string | null;
  link_url: string | null;
  ad_library_url: string | null;
  publisher_platforms: string[] | null;
  format: string | null;
  angle: string | null;
  hook: string | null;
  offer: string | null;
  why_notable: string | null;
  first_seen_at: string;
}

interface BrandCandidate {
  page_id: string;
  name: string;
  category: string | null;
  likes: number | null;
  verification: string | null;
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

const NEW_WINDOW_MS = 7 * 86_400_000;
const isNew = (ad: CompetitorAd) => Date.now() - new Date(ad.first_seen_at).getTime() <= NEW_WINDOW_MS;

function runningDays(ad: CompetitorAd): number | null {
  if (!ad.started_at) return null;
  const end = ad.is_active ? Date.now() : new Date(ad.ended_at ?? ad.first_seen_at).getTime();
  return Math.max(1, Math.round((end - new Date(ad.started_at).getTime()) / 86_400_000));
}

// --- main view -----------------------------------------------------------------

export function GrowthCompetitors({ onAsk }: { onAsk: (prompt: string) => void }) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [brands, setBrands] = React.useState<CompetitorBrand[]>([]);
  const [ads, setAds] = React.useState<CompetitorAd[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  const [brandFilter, setBrandFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "ended">("active");
  const [newOnly, setNewOnly] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<"newest" | "longest">("newest");
  const [openAd, setOpenAd] = React.useState<CompetitorAd | null>(null);
  const [trackOpen, setTrackOpen] = React.useState(false);
  const [scraping, setScraping] = React.useState(false);
  const [removing, setRemoving] = React.useState<CompetitorBrand | null>(null);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError(null);
        const [b, a] = await Promise.all([
          sb<CompetitorBrand[]>(`competitor_brands?select=*&order=page_name.asc&limit=100`),
          sb<CompetitorAd[]>(`competitor_ads?select=*&order=first_seen_at.desc&limit=2000`),
        ]);
        if (!alive) return;
        setBrands(b);
        setAds(a);
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

  const newCountByPage = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of ads) if (isNew(a)) m.set(a.page_id, (m.get(a.page_id) ?? 0) + 1);
    return m;
  }, [ads]);

  const filtered = React.useMemo(() => {
    let out = ads;
    if (brandFilter !== "all") out = out.filter((a) => a.page_id === brandFilter);
    if (statusFilter === "active") out = out.filter((a) => a.is_active);
    else if (statusFilter === "ended") out = out.filter((a) => !a.is_active);
    if (newOnly) out = out.filter(isNew);
    if (sortBy === "longest") {
      out = [...out].sort((a, b) => (runningDays(b) ?? 0) - (runningDays(a) ?? 0));
    }
    return out;
  }, [ads, brandFilter, statusFilter, newOnly, sortBy]);

  const scrapeNow = async (pageId?: string) => {
    setScraping(true);
    try {
      const res = await fetch("/api/growth/competitors/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pageId ? { page_id: pageId } : {}),
      });
      const body = (await res.json()) as { total_new?: number; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast(`Scraped — ${body.total_new ?? 0} new ad${body.total_new === 1 ? "" : "s"}`);
      refresh();
    } catch (e) {
      toast(`Scrape failed: ${(e as Error).message}`);
    } finally {
      setScraping(false);
    }
  };

  const removeBrand = async (b: CompetitorBrand) => {
    try {
      await sb(`competitor_brands?id=eq.${b.id}`, { method: "DELETE" });
      toast(`Stopped tracking ${b.page_name}`);
      if (brandFilter === b.page_id) setBrandFilter("all");
      refresh();
    } catch {
      toast("Remove failed");
    }
  };

  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} h={280} radius={14} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* ---- tracked brands ---- */}
      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
            {ads.length} ads tracked · re-checked Tue &amp; Fri
          </span>
        }
      >
        Tracked competitors
      </SectionLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <BrandChip
          label="All brands"
          active={brandFilter === "all"}
          onClick={() => setBrandFilter("all")}
        />
        {brands.map((b) => (
          <BrandChip
            key={b.id}
            label={b.page_name}
            newCount={newCountByPage.get(b.page_id) ?? 0}
            active={brandFilter === b.page_id}
            paused={!b.active}
            onClick={() => setBrandFilter(brandFilter === b.page_id ? "all" : b.page_id)}
            onAnalyze={() =>
              onAsk(
                `Analyze ${b.page_name}'s current Meta ads strategy from our competitor tracker (use the competitor_ads tool): their angles, formats, offers, what's working (longest-running ads), what changed recently, and exactly how DreamMe should position against them.`,
              )
            }
            onRemove={() => setRemoving(b)}
          />
        ))}
        <button
          onClick={() => setTrackOpen(true)}
          style={{
            padding: "7px 14px",
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 999,
            border: "1px dashed var(--line-2)",
            background: "var(--surface)",
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          ＋ Track brand
        </button>
        <button
          onClick={() => void scrapeNow(brandFilter === "all" ? undefined : brandFilter)}
          disabled={scraping || brands.length === 0}
          style={{
            marginLeft: "auto",
            padding: "7px 14px",
            fontSize: 12.5,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: scraping ? "var(--ink-4)" : "var(--ink-2)",
            cursor: scraping ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {scraping ? "Scraping…" : "↻ Scrape now"}
        </button>
      </div>

      {/* ---- filters ---- */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        <PillGroup
          options={[
            { id: "active", label: "Running" },
            { id: "ended", label: "Ended" },
            { id: "all", label: "All" },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
        />
        <PillGroup
          options={[
            { id: "newest", label: "Newest first" },
            { id: "longest", label: "Longest running" },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v as typeof sortBy)}
        />
        <button
          onClick={() => setNewOnly((v) => !v)}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 999,
            border: "1px solid",
            borderColor: newOnly ? "var(--accent)" : "var(--line)",
            background: newOnly ? "color-mix(in oklab, var(--accent) 12%, var(--surface))" : "var(--surface)",
            color: newOnly ? "var(--accent)" : "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          ✨ New this week
        </button>
      </div>

      {/* ---- grid ---- */}
      {brands.length === 0 ? (
        <EmptyState
          title="No competitors tracked yet."
          action={
            <button
              onClick={() => setTrackOpen(true)}
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
              ＋ Track your first brand
            </button>
          }
        >
          Type a competitor&rsquo;s brand name, pick their Meta page, and every ad they run gets
          pulled, analyzed, and monitored.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches these filters.">
          Loosen a filter — or hit Scrape now to pull the latest ads.
        </EmptyState>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 155 : 220}px, 1fr))`,
            gap: 14,
          }}
        >
          {filtered.map((ad) => (
            <AdCard key={ad.id} ad={ad} showBrand={brandFilter === "all"} onOpen={() => setOpenAd(ad)} />
          ))}
        </div>
      )}

      {openAd && <CompetitorAdDrawer ad={openAd} onClose={() => setOpenAd(null)} onAsk={onAsk} />}

      {trackOpen && (
        <TrackBrandSheet
          existingPageIds={new Set(brands.map((b) => b.page_id))}
          onClose={() => setTrackOpen(false)}
          onAdded={(pageId) => {
            refresh();
            void scrapeNow(pageId);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Stop tracking ${removing.page_name}?`}
          message="The brand is removed from monitoring. Ads already captured stay in the archive."
          confirmLabel="Stop tracking"
          destructive
          onConfirm={() => {
            void removeBrand(removing);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

// --- atoms ---------------------------------------------------------------------

function PillGroup({
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

function BrandChip({
  label,
  newCount = 0,
  active,
  paused,
  onClick,
  onAnalyze,
  onRemove,
}: {
  label: string;
  newCount?: number;
  active: boolean;
  paused?: boolean;
  onClick: () => void;
  onAnalyze?: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 6px 6px 14px",
        borderRadius: 999,
        border: "1px solid",
        borderColor: active ? "var(--ink)" : "var(--line)",
        background: active ? "var(--ink)" : "var(--surface)",
        opacity: paused ? 0.55 : 1,
      }}
    >
      <button
        onClick={onClick}
        style={{
          border: "none",
          background: "transparent",
          fontSize: 12.5,
          fontWeight: 600,
          color: active ? "var(--surface)" : "var(--ink)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {label}
      </button>
      {newCount > 0 && (
        <span
          title={`${newCount} new ad${newCount === 1 ? "" : "s"} this week`}
          style={{
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "var(--font-geist-mono), monospace",
            padding: "2px 7px",
            borderRadius: 999,
            background: "var(--accent)",
            color: "#fff",
          }}
        >
          {newCount} new
        </span>
      )}
      {onAnalyze && (
        <button
          onClick={onAnalyze}
          title="Analyze this brand's ad strategy with AI"
          style={{
            border: "none",
            background: "transparent",
            fontSize: 12,
            color: active ? "var(--surface)" : "var(--ink-3)",
            cursor: "pointer",
            padding: "0 2px",
          }}
        >
          ✦
        </button>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          title="Stop tracking"
          style={{
            border: "none",
            background: "transparent",
            fontSize: 11,
            color: active ? "var(--surface)" : "var(--ink-4)",
            cursor: "pointer",
            padding: "0 4px 0 0",
          }}
        >
          ✕
        </button>
      )}
    </span>
  );
}

// --- ad card --------------------------------------------------------------------

function AdCard({ ad, showBrand, onOpen }: { ad: CompetitorAd; showBrand: boolean; onOpen: () => void }) {
  const days = runningDays(ad);
  return (
    <article
      onClick={onOpen}
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
    >
      <div style={{ position: "relative", aspectRatio: "1 / 1", background: "var(--surface-2)" }}>
        {ad.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.thumbnail_url}
            alt={ad.title ?? "competitor ad"}
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
              padding: 14,
              fontSize: 11.5,
              lineHeight: 1.5,
              color: "var(--ink-3)",
              textAlign: "center",
            }}
          >
            {(ad.body ?? "").slice(0, 120) || "no creative preview"}
          </div>
        )}
        {isNew(ad) && (
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "3px 9px",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              borderRadius: 999,
              background: "var(--accent)",
              color: "#fff",
            }}
          >
            NEW
          </span>
        )}
        {ad.media_type === "video" && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              padding: "3px 8px",
              fontSize: 9.5,
              fontWeight: 700,
              borderRadius: 999,
              background: "rgba(26,24,22,0.72)",
              color: "#fff",
            }}
          >
            ▶ video
          </span>
        )}
        {days != null && (
          <span
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              padding: "3px 9px",
              fontSize: 10.5,
              fontWeight: 600,
              borderRadius: 999,
              background: "rgba(26,24,22,0.78)",
              color: "#fff",
              backdropFilter: "blur(4px)",
            }}
            title={ad.is_active ? "Days this ad has been running — longevity is a winner signal" : "Total days it ran"}
          >
            {ad.is_active ? `running ${days}d` : `ran ${days}d`}
          </span>
        )}
      </div>
      <div style={{ padding: "10px 12px 12px", display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {showBrand ? ad.page_name ?? "?" : ad.title ?? ad.cta_text ?? ""}
          </span>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
              background: ad.is_active ? "var(--accent-2)" : "var(--ink-4)",
            }}
            title={ad.is_active ? "Running" : "Ended"}
          />
        </div>
        {ad.hook && (
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
            “{ad.hook}”
          </div>
        )}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {ad.angle && <TagChip kind="theme">{ad.angle}</TagChip>}
          {ad.format && <TagChip kind="format">{ad.format}</TagChip>}
        </div>
      </div>
    </article>
  );
}

// --- drawer ---------------------------------------------------------------------

function CompetitorAdDrawer({
  ad,
  onClose,
  onAsk,
}: {
  ad: CompetitorAd;
  onClose: () => void;
  onAsk: (prompt: string) => void;
}) {
  const isMobile = useIsMobile();
  const days = runningDays(ad);
  const context =
    `Competitor: ${ad.page_name} · ${ad.media_type ?? "?"} ad ${ad.is_active ? `running ${days ?? "?"}d` : `ended after ${days ?? "?"}d`}\n` +
    `Hook: "${ad.hook ?? "?"}" · Angle: ${ad.angle ?? "?"} · Format: ${ad.format ?? "?"} · Offer: ${ad.offer || "none"}\n` +
    `Copy: ${(ad.body ?? "").slice(0, 400)}\n` +
    `AI read: ${ad.why_notable ?? "?"}`;

  return (
    <Sheet open onClose={onClose} desktopMaxWidth={620} ariaLabel="Competitor ad details">
      <div style={{ display: "flex", gap: 18, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ flexShrink: 0, width: isMobile ? "100%" : 230 }}>
          {ad.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ad.thumbnail_url}
              alt="ad creative"
              style={{
                width: isMobile ? 180 : 230,
                borderRadius: 12,
                border: "1px solid var(--line)",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: isMobile ? 180 : 230,
                aspectRatio: "1 / 1",
                borderRadius: 12,
                border: "1px dashed var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-4)",
                fontSize: 12,
              }}
            >
              no preview
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-geist-mono), monospace", lineHeight: 1.6 }}>
            {ad.is_active ? "● running" : "○ ended"}
            {days != null && ` · ${days}d`}
            {ad.started_at && ` · since ${new Date(ad.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            <br />
            {(ad.publisher_platforms ?? []).map((p) => p.toLowerCase()).join(" · ")}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>
          <div>
            <div className="serif" style={{ fontSize: 21, letterSpacing: "-0.01em" }}>
              {ad.page_name ?? "Competitor ad"}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {ad.angle && <TagChip kind="theme">{ad.angle}</TagChip>}
              {ad.format && <TagChip kind="format">{ad.format}</TagChip>}
              {ad.offer && <TagChip kind="audience">{ad.offer}</TagChip>}
            </div>
          </div>

          {ad.hook && (
            <div>
              <DrawerLabel>Hook</DrawerLabel>
              <div className="serif" style={{ fontSize: 16, fontStyle: "italic", lineHeight: 1.4 }}>
                “{ad.hook}”
              </div>
            </div>
          )}

          {ad.why_notable && (
            <div>
              <DrawerLabel>Strategic read · AI</DrawerLabel>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{ad.why_notable}</div>
            </div>
          )}

          {(ad.title || ad.body) && (
            <div>
              <DrawerLabel>Ad copy</DrawerLabel>
              {ad.title && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{ad.title}</div>}
              {ad.body && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    maxHeight: 130,
                    overflowY: "auto",
                    padding: "8px 10px",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                  }}
                >
                  {ad.body}
                </div>
              )}
              {ad.cta_text && (
                <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 5 }}>
                  CTA: {ad.cta_text}
                  {ad.link_url ? ` → ${ad.link_url.slice(0, 60)}` : ""}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button
              onClick={() => {
                onClose();
                onAsk(
                  `Counter this competitor ad for DreamMe:\n${context}\n\nGive me: why it works (or doesn't), the gap it leaves open, and a DreamMe counter-ad brief — 3 hook options, format, and the angle we own that they can't.`,
                );
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
              ✦ Counter this ad
            </button>
            <button
              onClick={() => {
                onClose();
                onAsk(`Analyze this competitor ad in depth:\n${context}`);
              }}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              ✦ Analyze
            </button>
            <a
              href={ad.ad_library_url ?? `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`}
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
              Ad Library ↗
            </a>
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

// --- track-brand sheet -------------------------------------------------------------

function TrackBrandSheet({
  existingPageIds,
  onClose,
  onAdded,
}: {
  existingPageIds: Set<string>;
  onClose: () => void;
  onAdded: (pageId: string) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [candidates, setCandidates] = React.useState<BrandCandidate[] | null>(null);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setCandidates(null);
    setSearchError(null);
    try {
      const res = await fetch("/api/growth/competitors/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const body = (await res.json()) as { candidates?: BrandCandidate[]; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCandidates(body.candidates ?? []);
    } catch (e) {
      // Distinguish API failures (credits, key) from a genuine no-match —
      // "no pages found" on an out-of-credits account is a lie.
      setSearchError((e as Error).message);
      toast("Search failed");
    } finally {
      setSearching(false);
    }
  };

  const add = async (c: BrandCandidate) => {
    setAdding(c.page_id);
    try {
      await sb(`competitor_brands`, {
        method: "POST",
        body: JSON.stringify({
          page_id: c.page_id,
          page_name: c.name,
          brand_name: query.trim() || c.name,
          category: c.category,
        }),
      });
      toast(`Tracking ${c.name} — pulling their ads…`);
      onAdded(c.page_id);
      onClose();
    } catch (e) {
      toast(`Add failed: ${(e as Error).message}`);
      setAdding(null);
    }
  };

  return (
    <Sheet open onClose={onClose} desktopMaxWidth={520} ariaLabel="Track a competitor brand">
      <div className="serif" style={{ fontSize: 21, marginBottom: 4 }}>
        Track a competitor
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 14px", lineHeight: 1.5 }}>
        Type the brand name, pick their Meta page, and every ad they run gets pulled, analyzed,
        and monitored for new launches.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="e.g. Glowise, Shotsy, Noom…"
          autoFocus
          style={{
            flex: 1,
            padding: "9px 12px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: 13.5,
            outline: "none",
          }}
        />
        <button
          onClick={() => void search()}
          disabled={searching || !query.trim()}
          style={{
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 10,
            border: "1px solid var(--ink)",
            background: searching || !query.trim() ? "var(--surface-2)" : "var(--ink)",
            color: searching || !query.trim() ? "var(--ink-4)" : "var(--surface)",
            cursor: searching || !query.trim() ? "default" : "pointer",
          }}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {searchError && (
        <div
          style={{
            fontSize: 12.5,
            color: "var(--accent)",
            padding: "9px 12px",
            borderRadius: 10,
            background: "color-mix(in oklab, var(--accent) 9%, var(--surface))",
            border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            lineHeight: 1.5,
          }}
        >
          {searchError.includes("out of credits")
            ? "The ScrapeCreators account is out of credits — top it up at scrapecreators.com, then search again."
            : searchError}
        </div>
      )}

      {candidates && candidates.length === 0 && !searchError && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          No Meta pages found for that name — try the exact page name from Facebook/Instagram.
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div style={{ display: "grid", gap: 6, maxHeight: 340, overflowY: "auto" }}>
          {candidates.map((c) => {
            const tracked = existingPageIds.has(c.page_id);
            return (
              <div
                key={c.page_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {c.name}
                    {c.verification === "BLUE_VERIFIED" && (
                      <span title="Verified page" style={{ marginLeft: 5, fontSize: 11 }}>✔</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
                    {c.category ?? "page"} · id {c.page_id}
                    {c.likes != null ? ` · ${c.likes.toLocaleString()} likes` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void add(c)}
                  disabled={tracked || adding === c.page_id}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 999,
                    border: "1px solid var(--line)",
                    background: tracked ? "var(--surface-2)" : "var(--ink)",
                    color: tracked ? "var(--ink-4)" : "var(--surface)",
                    cursor: tracked ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tracked ? "Tracked" : adding === c.page_id ? "Adding…" : "＋ Track"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
