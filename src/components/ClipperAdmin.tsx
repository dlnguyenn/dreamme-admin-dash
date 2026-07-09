"use client";

/**
 * Clippers — admin screen for the rev-share program.
 *
 * The code roster + funnel come from the DreamMe app's referral system (codes
 * are created there and appear here automatically). This screen manages the
 * dashboard-owned overlay per code (rev-share %, Facebook page, videos,
 * payouts) and shows the computed pay from RevenueCat transactions.
 *
 * Data via /api/clippers (same-origin; checkIngestAuth). Money math + roster
 * merge live server-side — this screen only renders it.
 */
import * as React from "react";
import { Button, Chip, useToast } from "./ui";

interface Totals {
  videos: number;
  views: number;
  entered: number | null;
  conversions: number; // headline = app purchased count
  pricedConversions: number; // rc_events-derived (money we can price)
  netUsd: number;
  pendingUsd: number;
  payableUsd: number;
  paidUsd: number;
  balanceUsd: number;
}
interface VideoRow {
  id: string;
  url: string;
  platform: string;
  title: string | null;
  posted_at: string | null;
  views: number | null;
  manual_views: number | null;
  views_updated_at: string | null;
  scrape_status: string | null;
  source: string;
}
interface PayoutRow {
  id: string;
  amount_usd: number;
  paid_at: string;
  method: string | null;
  note: string | null;
}
interface TxnRow {
  transactionId: string;
  type: string;
  eventAt: string;
  netUsd: number;
  earningUsd: number;
  status: "pending" | "payable" | "refunded";
  daysLeft?: number;
}
interface ClipperItem {
  id: string;
  name: string;
  code: string;
  facebook_page_url: string | null;
  revshare_pct: number;
  token: string;
  active: boolean;
  notes: string | null;
  discount_percent: number | null;
  inApp: boolean;
  totals: Totals;
  videos: VideoRow[];
  payouts: PayoutRow[];
  recentTxns: TxnRow[];
}

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtInt(n: number | null): string {
  return n != null && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/clippers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const label: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "var(--ink-3)",
  fontFamily: "var(--font-geist-mono)",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 13,
  outline: "none",
};
const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
};

export function ClipperAdmin() {
  const toast = useToast();
  const [items, setItems] = React.useState<ClipperItem[]>([]);
  const [feedOn, setFeedOn] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/clippers");
      const data = (await res.json()) as {
        clippers?: ClipperItem[];
        appFeedConfigured?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems(data.clippers ?? []);
      setFeedOn(data.appFeedConfigured !== false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function run(action: string, body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      await api({ action, ...body });
      toast(okMsg);
      await load();
    } catch (e) {
      toast(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function copyLink(c: ClipperItem) {
    const link = `${window.location.origin}/clip/${c.token}`;
    void navigator.clipboard.writeText(link);
    toast(`Link copied — ${c.name}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>Clippers</div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
            Codes are created in the app and appear here automatically. Pay = % of net proceeds,
            payable 30 days after each charge, 12-month cap per subscriber.
          </div>
        </div>
        <Button onClick={() => void load()} disabled={busy}>
          Refresh
        </Button>
      </div>

      {!feedOn ? (
        <div
          style={{
            ...card,
            padding: "12px 16px",
            fontSize: 13,
            color: "var(--ink-2)",
            borderColor: "var(--accent)",
            background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
          }}
        >
          <strong>App referral feed not connected.</strong> Showing local overlays only. Set{" "}
          <code>APP_REFERRAL_STATS_URL</code> and <code>APP_REFERRAL_STATS_TOKEN</code> (from David)
          to auto-populate creators + conversion counts.
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 24 }}>Loading…</div>
      ) : error ? (
        <div style={{ color: "var(--accent)", fontSize: 13, padding: 24 }}>{error}</div>
      ) : items.length === 0 ? (
        <div style={{ ...card, padding: 32, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
          No creator codes yet. Once a code is created in the app, it shows up here — then set its
          rev-share %, Facebook page, and videos.
        </div>
      ) : (
        items.map((c) => (
          <div key={c.id} style={{ ...card, opacity: c.active ? 1 : 0.55 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 16px",
                cursor: "pointer",
                flexWrap: "wrap",
              }}
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            >
              <div style={{ minWidth: 150 }}>
                <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>{c.name}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <Chip tone="accent">{c.code}</Chip>
                  <Chip tone="neutral">{Number(c.revshare_pct)}%</Chip>
                  {c.discount_percent ? <Chip tone="neutral">−{c.discount_percent}%</Chip> : null}
                  {!c.active ? <Chip tone="ink">inactive</Chip> : null}
                  {!c.inApp ? <Chip tone="ink">not in app</Chip> : null}
                </div>
              </div>
              <Stat l="Videos" v={fmtInt(c.totals.videos)} />
              <Stat l="Views" v={fmtInt(c.totals.views)} />
              <Stat l="Entered" v={fmtInt(c.totals.entered)} />
              <Stat l="Convs" v={fmtInt(c.totals.conversions)} />
              <Stat l="Net rev" v={fmtUSD(c.totals.netUsd)} />
              <Stat l="Pending" v={fmtUSD(c.totals.pendingUsd)} />
              <Stat l="Payable" v={fmtUSD(c.totals.payableUsd)} />
              <Stat l="Paid" v={fmtUSD(c.totals.paidUsd)} />
              <Stat l="Balance" v={fmtUSD(c.totals.balanceUsd)} strong />
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyLink(c);
                  }}
                >
                  Copy link
                </Button>
              </div>
            </div>

            {expanded === c.id ? <ClipperDetail clipper={c} busy={busy} run={run} /> : null}
          </div>
        ))
      )}
    </div>
  );
}

function Stat({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div style={{ minWidth: 62 }}>
      <div style={label}>{l}</div>
      <div
        style={{
          fontSize: 14,
          fontWeight: strong ? 700 : 500,
          color: strong ? "var(--accent)" : "var(--ink)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {v}
      </div>
    </div>
  );
}

function ClipperDetail({
  clipper: c,
  busy,
  run,
}: {
  clipper: ClipperItem;
  busy: boolean;
  run: (action: string, body: Record<string, unknown>, okMsg: string) => Promise<void>;
}) {
  const [pct, setPct] = React.useState(String(c.revshare_pct));
  const [fbUrl, setFbUrl] = React.useState(c.facebook_page_url ?? "");
  const [videoUrl, setVideoUrl] = React.useState("");
  const [payoutAmt, setPayoutAmt] = React.useState("");
  const [payoutNote, setPayoutNote] = React.useState("");

  const section: React.CSSProperties = { padding: "14px 16px", borderTop: "1px solid var(--line)" };
  const settingsDirty =
    Number(pct) !== Number(c.revshare_pct) || (fbUrl || "") !== (c.facebook_page_url ?? "");

  return (
    <div>
      {/* overlay settings (dashboard-owned) */}
      <div style={{ ...section, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 90px" }}>
          <div style={label}>Rev-share %</div>
          <input style={input} value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" />
        </div>
        <div style={{ flex: "2 1 320px" }}>
          <div style={label}>Facebook page URL (daily scan)</div>
          <input
            style={input}
            value={fbUrl}
            onChange={(e) => setFbUrl(e.target.value)}
            placeholder="https://www.facebook.com/…"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !settingsDirty}
          onClick={() =>
            void run(
              "update_clipper",
              { id: c.id, revshare_pct: Number(pct) || 20, facebook_page_url: fbUrl || null },
              "Saved",
            )
          }
        >
          Save settings
        </Button>
        <span style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: "auto" }}>
          /clip/{c.token.slice(0, 8)}…
        </span>
      </div>

      {/* videos */}
      <div style={section}>
        <div style={{ ...label, marginBottom: 8 }}>Videos ({c.videos.length})</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            style={{ ...input, maxWidth: 420 }}
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Add a video URL manually…"
          />
          <Button
            size="sm"
            disabled={busy || !videoUrl.trim()}
            onClick={() =>
              void run("add_video", { clipper_id: c.id, url: videoUrl.trim() }, "Video added").then(
                () => setVideoUrl(""),
              )
            }
          >
            Add
          </Button>
        </div>
        {c.videos.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            None yet — daily scan will pick up their Facebook page
            {c.facebook_page_url ? "" : " (no page URL set!)"}.
          </div>
        ) : (
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <tbody>
              {c.videos.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid var(--line-2)" }}>
                  <td style={{ padding: "6px 4px", maxWidth: 340 }}>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--accent)",
                        textDecoration: "none",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v.title?.trim() || v.url}
                    </a>
                  </td>
                  <td style={{ padding: "6px 4px", color: "var(--ink-3)" }}>{v.platform}</td>
                  <td style={{ padding: "6px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtInt(Number(v.views ?? v.manual_views ?? 0))}
                    {v.views == null && v.manual_views != null ? " (manual)" : ""}
                  </td>
                  <td style={{ padding: "6px 4px", color: "var(--ink-4)", fontSize: 11 }}>
                    {v.scrape_status && v.scrape_status !== "ok" ? v.scrape_status : fmtDate(v.views_updated_at)}
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    <ManualViews video={v} busy={busy} run={run} />
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run("delete_video", { id: v.id }, "Video removed")}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* earnings */}
      <div style={section}>
        <div style={{ ...label, marginBottom: 8 }}>
          Recent earnings
          {c.totals.conversions !== c.totals.pricedConversions ? (
            <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-4)", marginLeft: 8 }}>
              ({c.totals.conversions} app conversions · {c.totals.pricedConversions} priced from RC)
            </span>
          ) : null}
        </div>
        {c.recentTxns.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            No priced transactions yet (code {c.code}). Conversions before the money-webhook show in
            the app count but have no revenue data.
          </div>
        ) : (
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <tbody>
              {c.recentTxns.slice(0, 15).map((t) => (
                <tr key={t.transactionId} style={{ borderBottom: "1px solid var(--line-2)" }}>
                  <td style={{ padding: "6px 4px" }}>{fmtDate(t.eventAt)}</td>
                  <td style={{ padding: "6px 4px", color: "var(--ink-3)" }}>
                    {t.type === "INITIAL_PURCHASE" ? "New" : "Renewal"}
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtUSD(t.netUsd)} net
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {t.status === "refunded" ? "—" : fmtUSD(t.earningUsd)}
                  </td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    <Chip tone={t.status === "payable" ? "success" : t.status === "pending" ? "neutral" : "ink"}>
                      {t.status === "pending" ? `pending ${t.daysLeft}d` : t.status}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* payouts */}
      <div style={section}>
        <div style={{ ...label, marginBottom: 8 }}>Payouts · balance {fmtUSD(c.totals.balanceUsd)}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...input, maxWidth: 120 }}
            value={payoutAmt}
            onChange={(e) => setPayoutAmt(e.target.value)}
            placeholder={c.totals.balanceUsd > 0 ? c.totals.balanceUsd.toFixed(2) : "0.00"}
            inputMode="decimal"
          />
          <input
            style={{ ...input, maxWidth: 260 }}
            value={payoutNote}
            onChange={(e) => setPayoutNote(e.target.value)}
            placeholder="Note (e.g. June payout, Venmo)"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !(Number(payoutAmt) > 0)}
            onClick={() =>
              void run(
                "record_payout",
                { clipper_id: c.id, amount_usd: Number(payoutAmt), note: payoutNote || null },
                "Payout recorded",
              ).then(() => {
                setPayoutAmt("");
                setPayoutNote("");
              })
            }
          >
            Record payout
          </Button>
        </div>
        {c.payouts.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              fontSize: 12.5,
              padding: "4px 0",
              color: "var(--ink-2)",
            }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtDate(p.paid_at)}</span>
            <span style={{ fontWeight: 600 }}>{fmtUSD(Number(p.amount_usd))}</span>
            <span style={{ color: "var(--ink-4)" }}>{p.note ?? p.method ?? ""}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run("delete_payout", { id: p.id }, "Payout deleted")}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualViews({
  video: v,
  busy,
  run,
}: {
  video: VideoRow;
  busy: boolean;
  run: (action: string, body: Record<string, unknown>, okMsg: string) => Promise<void>;
}) {
  const [val, setVal] = React.useState(v.manual_views != null ? String(v.manual_views) : "");
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <input
        style={{
          width: 84,
          padding: "3px 6px",
          borderRadius: 6,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontSize: 11.5,
        }}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="manual views"
        inputMode="numeric"
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || val === "" || Number(val) === v.manual_views}
        onClick={() =>
          void run("update_video", { id: v.id, manual_views: Number(val) || 0 }, "Views set")
        }
      >
        Set
      </Button>
    </span>
  );
}
