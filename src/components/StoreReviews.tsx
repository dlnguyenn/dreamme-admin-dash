"use client";

/**
 * Store Reviews tab — App Store + Google Play written reviews in one feed,
 * with the ones that need a reply up top. Reviews are synced daily into
 * store_reviews (the Sync button runs it now); the attention rules live in
 * src/lib/store-reviews.ts. Replies are written in the stores themselves;
 * "Mark handled" clears a review here without replying.
 */

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { Card, CategoryTag, ErrorBanner, FilterPill, InfoWell, StatStrip, StatusPill } from "./porcelain";
import { REASON_LABELS, type Attention, type Store, type StoreReviewRow, type StoreSummary, type SyncResult } from "@/lib/store-reviews-shared";

type Review = StoreReviewRow & { attention: Attention };
interface Payload {
  reviews: Review[];
  summary: StoreSummary[];
  configured: Record<Store, boolean>;
  links: Record<Store, string>;
}

type Filter = "attention" | "all" | "app_store" | "google_play" | "low";

const STORE_LABEL: Record<Store, string> = { app_store: "App Store", google_play: "Google Play" };
const one = (n: number | null) => (n == null ? "n/a" : n.toFixed(1));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function Stars({ n }: { n: number }) {
  const color = n <= 2 ? "var(--danger)" : n === 3 ? "var(--attention)" : "var(--success)";
  return (
    <span style={{ display: "inline-flex", gap: 1, color }} aria-label={`${n} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (i <= n ? <Icons.StarFilled key={i} size={14} /> : <Icons.Star key={i} size={14} />))}
    </span>
  );
}

function ReviewCard({ r, link, isAdmin, onHandled }: { r: Review; link: string; isAdmin: boolean; onHandled: (handled: boolean) => void }) {
  const meta = [STORE_LABEL[r.store], r.reviewer, r.territory ?? r.language, r.app_version && `v${r.app_version}`, r.device]
    .filter(Boolean)
    .join(" · ");
  const handled = !!r.handled_at && Date.parse(r.handled_at) >= Date.parse(r.reviewed_at);
  return (
    <Card style={{ borderLeft: r.attention.needsAttention ? `3px solid var(${r.attention.urgent ? "--danger" : "--attention"})` : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <Stars n={r.rating} />
        <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
          {day(r.reviewed_at)} · {meta}
        </span>
        <span style={{ flex: 1 }} />
        {r.attention.reasons.map((x) => (
          <CategoryTag key={x} family={x === "billing" || x === "broken" ? "danger" : "attention"}>
            {REASON_LABELS[x]}
          </CategoryTag>
        ))}
        {r.reply_body && !r.attention.needsAttention && <CategoryTag family="success">Replied</CategoryTag>}
        {handled && !r.reply_body && <CategoryTag family="neutral">Handled</CategoryTag>}
      </div>
      {r.title && <div style={{ font: "650 14px var(--font-ui)", color: "var(--ink)", marginBottom: 4 }}>{r.title}</div>}
      <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{r.body || "(no text)"}</div>
      {r.reply_body && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--neutral-soft)",
            font: "400 13px/1.45 var(--font-ui)",
            color: "var(--ink-2)",
          }}
        >
          <div style={{ font: "650 11px var(--font-ui)", color: "var(--ink-3)", marginBottom: 3 }}>
            Our reply{r.replied_at ? ` · ${day(r.replied_at)}` : ""}
            {r.reply_state && r.reply_state !== "PUBLISHED" ? ` · ${r.reply_state.toLowerCase().replace(/_/g, " ")}` : ""}
          </div>
          {r.reply_body}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <a href={link} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Button size="sm" variant="secondary" icon={<Icons.Link />}>
            Reply in {STORE_LABEL[r.store]}
          </Button>
        </a>
        {isAdmin && r.attention.needsAttention && (
          <Button size="sm" variant="ghost" icon={<Icons.Check />} onClick={() => onHandled(true)}>
            Mark handled
          </Button>
        )}
        {isAdmin && handled && (
          <Button size="sm" variant="ghost" onClick={() => onHandled(false)}>
            Reopen
          </Button>
        )}
      </div>
    </Card>
  );
}

export function StoreReviews({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("attention");
  const toast = useToast();

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/store-reviews", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const sync = React.useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/store-reviews", { method: "POST" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const failed = (body.results as SyncResult[]).filter((r) => !r.ok);
      if (failed.length) setError(failed.map((f) => `${STORE_LABEL[f.store]}: ${f.error}`).join(" · "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const markHandled = async (r: Review, handled: boolean) => {
    const res = await fetch("/api/store-reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, handled }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) {
      toast(body.error ?? "Could not update");
      return;
    }
    await load();
  };

  const reviews = data?.reviews ?? [];
  const counts: Record<Filter, number> = {
    attention: reviews.filter((r) => r.attention.needsAttention).length,
    all: reviews.length,
    app_store: reviews.filter((r) => r.store === "app_store").length,
    google_play: reviews.filter((r) => r.store === "google_play").length,
    low: reviews.filter((r) => r.rating <= 3).length,
  };
  const shown = reviews
    .filter((r) =>
      filter === "attention"
        ? r.attention.needsAttention
        : filter === "low"
          ? r.rating <= 3
          : filter === "all"
            ? true
            : r.store === filter,
    )
    // Urgent first inside the attention view; newest first everywhere.
    .sort((a, b) =>
      filter === "attention" && a.attention.urgent !== b.attention.urgent
        ? a.attention.urgent
          ? -1
          : 1
        : Date.parse(b.reviewed_at) - Date.parse(a.reviewed_at),
    );

  const recent = reviews.filter((r) => Date.now() - Date.parse(r.reviewed_at) <= 30 * 86_400_000);
  const byStore = (s: Store) => data?.summary.find((x) => x.store === s);
  const ios = byStore("app_store");
  const play = byStore("google_play");
  const missing = data ? (Object.keys(data.configured) as Store[]).filter((s) => !data.configured[s]) : [];

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Support"
        title="Store Reviews"
        subtitle="Written App Store and Google Play reviews, synced daily. Anything unreplied that is 1-3 stars, mentions billing, or says the app is broken needs attention."
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {missing.length > 0 && (
        <InfoWell>
          {missing.map((s) => STORE_LABEL[s]).join(" and ")} credentials are not set on this deployment, so{" "}
          {missing.length > 1 ? "they are" : "it is"} not syncing. See src/lib/store-reviews.ts for the env vars.
        </InfoWell>
      )}
      {!data && !error && <InfoWell>Loading…</InfoWell>}

      {data && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            {counts.attention > 0 ? (
              <StatusPill kind="attention">{counts.attention} need attention</StatusPill>
            ) : (
              <StatusPill kind="success">All caught up</StatusPill>
            )}
            <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
              App Store synced {ago(ios?.lastSyncedAt ?? null)} · Google Play synced {ago(play?.lastSyncedAt ?? null)}
            </span>
          </div>

          <StatStrip
            stats={[
              { label: "Need attention", value: counts.attention, note: `${reviews.filter((r) => r.attention.urgent).length} billing or broken` },
              { label: "App Store avg", value: one(ios?.avgRating ?? null), note: `${ios?.count ?? 0} written · ${ios?.unreplied ?? 0} unreplied` },
              { label: "Google Play avg", value: one(play?.avgRating ?? null), note: `${play?.count ?? 0} written · ${play?.unreplied ?? 0} unreplied` },
              {
                label: "Last 30 days avg",
                value: one(recent.length ? recent.reduce((s, r) => s + r.rating, 0) / recent.length : null),
                note: `${recent.length} reviews, both stores`,
              },
            ]}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0 14px" }}>
            <FilterPill label="Needs attention" count={counts.attention} attention selected={filter === "attention"} onClick={() => setFilter("attention")} />
            <FilterPill label="All" count={counts.all} selected={filter === "all"} onClick={() => setFilter("all")} />
            <FilterPill label="App Store" count={counts.app_store} selected={filter === "app_store"} onClick={() => setFilter("app_store")} />
            <FilterPill label="Google Play" count={counts.google_play} selected={filter === "google_play"} onClick={() => setFilter("google_play")} />
            <FilterPill label="1-3 stars" count={counts.low} selected={filter === "low"} onClick={() => setFilter("low")} />
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {shown.length === 0 && (
              <InfoWell>{filter === "attention" ? "Nothing needs attention." : "No reviews yet. Press Sync now."}</InfoWell>
            )}
            {shown.map((r) => (
              <ReviewCard key={r.id} r={r} link={data.links[r.store]} isAdmin={isAdmin} onHandled={(h) => void markHandled(r, h)} />
            ))}
          </div>

          <div style={{ height: 16 }} />
          <InfoWell>
            Only written reviews are listed (neither store exposes star-only ratings per review). Google Play's API only returns the last 7
            days, so Play history starts on the first sync. A reply in the store clears a review on the next sync.
          </InfoWell>
        </>
      )}
    </div>
  );
}
