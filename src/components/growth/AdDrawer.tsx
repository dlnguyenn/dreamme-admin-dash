"use client";

/**
 * Growth AI · Ad drill-in — Motion's "Creative insights" equivalent.
 * Opens from any surface (leaderboard rows, shift cards, theme stacks,
 * launches). Everything derives from the already-fetched GrowthData;
 * the only network calls are the Re-tag button and (Phase 4) actions.
 */

import * as React from "react";
import { Sheet } from "../Sheet";
import { ConfirmDialog } from "../ConfirmDialog";
import { useToast } from "../ui";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  type GrowthData,
  type AdAgg,
  aggregateAds,
  sliceWindows,
  daysAgoISO,
  num,
  safeDiv,
} from "./data";
import {
  fmtUSD,
  fmtInt,
  fmtPct,
  weeksSince,
  DeltaChip,
  StatusDot,
  TagChip,
  Thumb,
  adsManagerAdUrl,
} from "./shared";
import { VISUAL_FORMAT_LABELS } from "@/lib/growth-tagging-shared";

export function AdDrawer({
  data,
  adId,
  onClose,
  onAsk,
}: {
  data: GrowthData;
  adId: string | null;
  onClose: () => void;
  onAsk: (prompt: string) => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const [retagging, setRetagging] = React.useState(false);
  const [confirmingStatus, setConfirmingStatus] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  const ad = React.useMemo(() => {
    if (!adId) return null;
    const full = aggregateAds(data.rows.filter((x) => x.ad_id === adId));
    return full.get(adId) ?? null;
  }, [data.rows, adId]);

  const adRows = React.useMemo(
    () => (adId ? data.rows.filter((x) => x.ad_id === adId) : []),
    [data.rows, adId],
  );

  const wow = React.useMemo(() => {
    if (!adId) return null;
    const { cur, prev } = sliceWindows(data.rows, 7);
    return { cur: cur.get(adId) ?? null, prev: prev.get(adId) ?? null };
  }, [data.rows, adId]);

  if (!adId || !ad) return null;

  const tag = data.tags.get(adId);
  const firstSeen = data.firstSeen.get(adId) ?? ad.first_seen;
  const copy = latestCopy(adRows);
  const cpt = safeDiv(ad.spend, ad.trial_starts);

  const retag = async () => {
    setRetagging(true);
    try {
      await fetch("/api/growth/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_ids: [adId], force: true }),
      });
      data.refresh();
    } finally {
      setRetagging(false);
    }
  };

  return (
    <Sheet open onClose={onClose} desktopMaxWidth={580} ariaLabel={`Ad details: ${ad.ad_name}`}>
      <div style={{ display: "grid", gap: 18 }}>
        {/* header */}
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Thumb src={ad.thumbnail} name={ad.ad_name} size={isMobile ? 72 : 92} radius={12} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="serif" style={{ fontSize: isMobile ? 18 : 21, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
              {ad.ad_name || ad.ad_id}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
              <StatusDot status={ad.effective_status} />
              <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-geist-mono), monospace" }}>
                launched {fmtDate(firstSeen)} · wk {weeksSince(firstSeen)}
              </span>
            </div>
            <div
              title={`${ad.campaign_name} · ${ad.adset_name}`}
              style={{
                fontSize: 11.5,
                color: "var(--ink-4)",
                marginTop: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {ad.campaign_name} · {ad.adset_name}
            </div>
          </div>
        </div>

        {/* tags */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {tag ? (
            <>
              <TagChip kind="format">
                {(VISUAL_FORMAT_LABELS as Record<string, string>)[tag.visual_format] ?? tag.visual_format}
              </TagChip>
              <TagChip kind="theme" title={tag.theme_description ?? undefined}>
                {tag.messaging_theme}
              </TagChip>
              {tag.audience && <TagChip kind="audience">{tag.audience}</TagChip>}
              {tag.hook_type && <TagChip kind="hook">{tag.hook_type} hook</TagChip>}
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>no AI tags yet</span>
          )}
          <button
            onClick={() => void retag()}
            disabled={retagging}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              color: "var(--ink-3)",
              cursor: retagging ? "default" : "pointer",
            }}
          >
            {retagging ? "Tagging…" : tag ? "↻ Re-tag" : "✦ Tag with AI"}
          </button>
        </div>

        {/* key numbers + WoW */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
          }}
        >
          <DrawerStat label="Spend · 8wk" value={fmtUSD(ad.spend)} delta={wowDelta(wow, "spend")} goodWhen="up" />
          <DrawerStat label="Trials" value={fmtInt(ad.trial_starts)} />
          <DrawerStat label="Cost / trial" value={Number.isFinite(cpt) ? fmtUSD(cpt) : "—"} />
          <DrawerStat
            label="Hook"
            value={fmtPct(safeDiv(ad.v3, ad.impressions))}
            delta={wowRateDelta(wow, "v3")}
            goodWhen="up"
          />
          <DrawerStat
            label="CTR"
            value={fmtPct(safeDiv(ad.clicks, ad.impressions))}
            delta={wowRateDelta(wow, "clicks")}
            goodWhen="up"
          />
        </div>

        {/* daily sparkline */}
        <div>
          <DrawerLabel>Daily spend + trials · last 28 days</DrawerLabel>
          <AdSparkline rows={adRows} />
        </div>

        {/* attention funnel */}
        <div>
          <DrawerLabel>Attention funnel · 8 weeks</DrawerLabel>
          <Funnel ad={ad} />
        </div>

        {/* copy */}
        {(copy.headline || copy.message) && (
          <div>
            <DrawerLabel>Ad copy</DrawerLabel>
            {copy.headline && (
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{copy.headline}</div>
            )}
            {copy.message && (
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  maxHeight: 140,
                  overflowY: "auto",
                  padding: "10px 12px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                }}
              >
                {copy.message}
              </div>
            )}
          </div>
        )}

        {/* actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              onClose();
              onAsk(
                `Analyze the ad "${ad.ad_name}" (ad_id ${ad.ad_id}) in depth — performance vs the account, where it loses people (hook/hold/click), whether it's fatiguing, and exactly what to do next.`,
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
            ✦ Analyze with AI
          </button>
          <a
            href={adsManagerAdUrl(ad.ad_id)}
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
            Open in Ads Manager ↗
          </a>
          {(ad.effective_status === "ACTIVE" || ad.effective_status === "PAUSED") && (
            <button
              onClick={() => setConfirmingStatus(true)}
              disabled={applying}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                borderRadius: 10,
                border: `1px solid ${ad.effective_status === "ACTIVE" ? "color-mix(in oklab, var(--accent) 45%, var(--line))" : "var(--line)"}`,
                background: "var(--surface)",
                color: ad.effective_status === "ACTIVE" ? "var(--accent)" : "var(--ink-2)",
                cursor: applying ? "default" : "pointer",
              }}
            >
              {applying ? "Applying…" : ad.effective_status === "ACTIVE" ? "⏸ Pause ad" : "▶ Resume ad"}
            </button>
          )}
        </div>
      </div>

      {confirmingStatus && (
        <ConfirmDialog
          title={ad.effective_status === "ACTIVE" ? "Pause this ad?" : "Resume this ad?"}
          message={
            <>
              <strong>{ad.ad_name || ad.ad_id}</strong>
              <br />
              <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                Applies to the live Meta account immediately and is logged.
              </span>
            </>
          }
          confirmLabel={ad.effective_status === "ACTIVE" ? "Pause ad" : "Resume ad"}
          destructive={ad.effective_status === "ACTIVE"}
          onConfirm={() => {
            setConfirmingStatus(false);
            setApplying(true);
            void (async () => {
              try {
                const res = await fetch("/api/growth/act", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: {
                      kind: ad.effective_status === "ACTIVE" ? "pause_ad" : "activate_ad",
                      target_id: ad.ad_id,
                      target_name: ad.ad_name,
                      reason: "manual from ad drawer",
                    },
                    confirm: true,
                    source: "ad_drawer",
                  }),
                });
                const body = (await res.json()) as { error?: string };
                if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
                toast(ad.effective_status === "ACTIVE" ? "Ad paused" : "Ad resumed");
                data.refresh();
              } catch (e) {
                toast(`Failed: ${(e as Error).message}`);
              } finally {
                setApplying(false);
              }
            })();
          }}
          onCancel={() => setConfirmingStatus(false)}
        />
      )}
    </Sheet>
  );
}

// --- helpers -----------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function latestCopy(rows: GrowthData["rows"]): { headline: string; message: string } {
  let headline = "";
  let message = "";
  let latest = "";
  for (const r of rows) {
    if (r.date >= latest) {
      latest = r.date;
      if (r.headline) headline = r.headline;
      if (r.message) message = r.message;
    }
  }
  return { headline, message };
}

function wowDelta(
  wow: { cur: AdAgg | null; prev: AdAgg | null } | null,
  key: "spend",
): number | null {
  if (!wow?.cur || !wow.prev || wow.prev[key] <= 0) return null;
  return ((wow.cur[key] - wow.prev[key]) / wow.prev[key]) * 100;
}

function wowRateDelta(
  wow: { cur: AdAgg | null; prev: AdAgg | null } | null,
  key: "v3" | "clicks",
): number | null {
  if (!wow?.cur || !wow.prev) return null;
  const cur = safeDiv(wow.cur[key], wow.cur.impressions);
  const prev = safeDiv(wow.prev[key], wow.prev.impressions);
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return (cur / prev - 1) * 100;
}

function DrawerLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: "var(--ink-3)",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function DrawerStat({
  label,
  value,
  delta,
  goodWhen,
}: {
  label: string;
  value: string;
  delta?: number | null;
  goodWhen?: "up" | "down";
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          marginBottom: 3,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {delta != null && <DeltaChip pct={delta} goodWhen={goodWhen} />}
      </div>
    </div>
  );
}

function AdSparkline({ rows }: { rows: GrowthData["rows"] }) {
  const daily = React.useMemo(() => {
    const since = daysAgoISO(27);
    const byDate = new Map<string, { spend: number; trials: number }>();
    for (const r of rows) {
      if (r.date < since) continue;
      const d = byDate.get(r.date) ?? { spend: 0, trials: 0 };
      d.spend += num(r.spend);
      d.trials += num(r.trial_starts);
      byDate.set(r.date, d);
    }
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [rows]);

  if (daily.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--ink-4)" }}>no delivery in the last 28 days</div>;
  }

  const W = 520;
  const H = 90;
  const maxSpend = Math.max(...daily.map((d) => d.spend), 1);
  const slot = W / daily.length;
  const barW = Math.max(3, slot * 0.6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {daily.map((d, i) => {
        const h = (d.spend / maxSpend) * (H - 18);
        const x = i * slot + (slot - barW) / 2;
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={H - 12 - h}
              width={barW}
              height={Math.max(h, d.spend > 0 ? 2 : 0)}
              rx={1.5}
              fill="color-mix(in oklab, var(--ink) 75%, transparent)"
            >
              <title>{`${d.date} · ${fmtUSD(d.spend)} · ${d.trials} trials`}</title>
            </rect>
            {d.trials > 0 && (
              <circle cx={x + barW / 2} cy={H - 16 - h} r={2.6} fill="var(--accent)">
                <title>{`${d.trials} trial${d.trials === 1 ? "" : "s"}`}</title>
              </circle>
            )}
          </g>
        );
      })}
      <text
        x={0}
        y={H - 1}
        style={{ fontSize: 9, fontFamily: "var(--font-geist-mono), monospace", fill: "var(--ink-4)" }}
      >
        {daily[0].date.slice(5)}
      </text>
      <text
        x={W}
        y={H - 1}
        textAnchor="end"
        style={{ fontSize: 9, fontFamily: "var(--font-geist-mono), monospace", fill: "var(--ink-4)" }}
      >
        {daily[daily.length - 1].date.slice(5)}
      </text>
    </svg>
  );
}

function Funnel({ ad }: { ad: AdAgg }) {
  const stages = [
    { label: "Impressions", value: ad.impressions },
    ...(ad.is_video
      ? [
          { label: "3s views", value: ad.v3 },
          { label: "Thruplays", value: ad.thru },
        ]
      : []),
    { label: "Clicks", value: ad.clicks },
    { label: "Installs", value: ad.installs },
    { label: "Trials", value: ad.trial_starts },
  ];
  const max = Math.max(stages[0]?.value ?? 1, 1);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const rate = prev != null && prev > 0 ? s.value / prev : null;
        return (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 86,
                fontSize: 11,
                color: "var(--ink-3)",
                fontFamily: "var(--font-geist-mono), monospace",
                whiteSpace: "nowrap",
              }}
            >
              {s.label}
            </span>
            <div style={{ flex: 1, height: 14, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(0.5, (s.value / max) * 100)}%`,
                  height: "100%",
                  background:
                    i === stages.length - 1
                      ? "var(--accent)"
                      : "color-mix(in oklab, var(--ink) 60%, transparent)",
                  borderRadius: 4,
                }}
              />
            </div>
            <span
              style={{
                width: 70,
                textAlign: "right",
                fontSize: 12,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtInt(s.value)}
            </span>
            <span style={{ width: 48, textAlign: "right", fontSize: 10.5, color: "var(--ink-4)" }}>
              {rate != null ? fmtPct(rate) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
