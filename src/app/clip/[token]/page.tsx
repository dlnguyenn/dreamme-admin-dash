/**
 * /clip/[token] — public per-clipper rev-share report ("public brand report"
 * style: stat tiles + tables). No login; the unguessable token IS the auth.
 *
 * Shows the clipper their videos + views, attributed conversions, and
 * estimated pay under the program rules: revshare_pct of net-of-Apple
 * proceeds, payable 30 days after each transaction, refunds excluded,
 * first 12 months per subscriber.
 *
 * Server component. Inline styles + CSS vars (Tailwind is not wired up in this
 * app — see globals.css); the whole surface is self-contained.
 */
import { notFound, redirect } from "next/navigation";
import * as React from "react";
import {
  clippersDbConfigured,
  loadClipperBundle,
  loadClipperBySlug,
  clipperSlug,
  effectiveViews,
  HOLDBACK_DAYS,
  REVSHARE_MONTHS_CAP,
  type EarningTxn,
} from "@/lib/clippers";
import { fetchCreatorStatByCode } from "@/lib/appReferrals";
import { SubmitVideoForm } from "./submit-form";
import { Onboarding } from "./onboarding";
import { ConnectPage } from "./connect-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACCENT = "#c96a4a";
const INK = "#1a1816";
const MUTED = "#9a8f85";
const BORDER = "#e7e2d8";

function fmtUSD(n: number, frac = 2): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: frac });
}
function fmtInt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const card: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};
const tileLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  color: MUTED,
};
const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: 18, fontWeight: 600, color: INK };
const th: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: MUTED,
  textAlign: "left",
  borderBottom: `1px solid #f0ece4`,
};
const td: React.CSSProperties = { padding: "10px 16px", fontSize: 13.5, color: "#3a332e" };
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const emptyCard: React.CSSProperties = {
  border: `1px dashed #d9d2c6`,
  borderRadius: 18,
  background: "rgba(255,255,255,0.5)",
  padding: "40px 24px",
  textAlign: "center",
  fontSize: 14,
  color: "#8a8078",
};

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...card, padding: "16px 20px" }}>
      <div style={tileLabel}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 24, fontWeight: 600, color: INK, ...num }}>{value}</div>
      {sub ? <div style={{ marginTop: 2, fontSize: 12, color: MUTED }}>{sub}</div> : null}
    </div>
  );
}

function StatusBadge({ txn }: { txn: EarningTxn }) {
  const map = {
    refunded: { bg: "#fdecec", fg: "#c0392b", text: "Refunded" },
    pending: { bg: "#fef6e7", fg: "#b7791f", text: `Pending · ${txn.daysLeft}d left` },
    payable: { bg: "#e9f7ef", fg: "#1e874b", text: "Payable" },
  } as const;
  const s = map[txn.status];
  return (
    <span
      style={{
        borderRadius: 999,
        background: s.bg,
        color: s.fg,
        padding: "3px 10px",
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {s.text}
    </span>
  );
}

function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...card, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
    </div>
  );
}

export default async function ClipperPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // `token` is the /clip/<segment> path: either a full legacy token or the
  // readable "code-tokenprefix" slug (see clipperSlug in lib/clippers).
  const { token: segment } = await params;
  if (!clippersDbConfigured()) notFound();

  const clipper = await loadClipperBySlug(segment);
  if (!clipper) notFound();

  // Send old/mistyped forms to the canonical pretty URL.
  const canonical = clipperSlug(clipper);
  if (segment.toLowerCase() !== canonical) redirect(`/clip/${canonical}`);

  // Islands post the same slug back; the public routes resolve it the same
  // way. Keeps the full token out of the rendered HTML entirely.
  const token = canonical;

  const [{ videos, earnings, totalViews, payouts }, appStat] = await Promise.all([
    loadClipperBundle(clipper),
    fetchCreatorStatByCode(clipper.code),
  ]);
  // App referral system is authoritative for display name + conversion count;
  // fall back to local/priced values when the feed isn't connected.
  const displayName = appStat?.creator_name ?? clipper.name;
  const conversions = appStat?.purchased ?? earnings.conversions;
  const pct = Number(clipper.revshare_pct);

  return (
    <main style={{ minHeight: "100vh", background: "#faf7f2", color: INK, padding: "40px 16px" }}>
      <div style={{ margin: "0 auto", maxWidth: 960 }}>
        {/* Header */}
        <header
          style={{
            marginBottom: 28,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: ACCENT }}>
              DreamMe · Creator Report
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 600 }}>{displayName}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Onboarding name={displayName} code={clipper.code} />
            <div
              style={{
                borderRadius: 12,
                border: `1px solid ${ACCENT}55`,
                background: `${ACCENT}18`,
                padding: "8px 16px",
                fontSize: 14,
              }}
            >
              Your code:{" "}
              <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontWeight: 700, color: ACCENT }}>
                {clipper.code}
              </span>
            </div>
          </div>
        </header>

        {/* Stat tiles */}
        <section
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          }}
        >
          <StatTile label="Total views" value={fmtInt(totalViews)} />
          <StatTile label="Videos" value={fmtInt(videos.length)} />
          <StatTile label="Conversions" value={fmtInt(conversions)} sub="subscribers via your code" />
          <StatTile label="Pending" value={fmtUSD(earnings.pendingUsd)} sub={`clears after ${HOLDBACK_DAYS} days`} />
          <StatTile label="Payable now" value={fmtUSD(earnings.balanceUsd > 0 ? earnings.balanceUsd : 0)} sub="after payouts to date" />
          <StatTile label="Paid to date" value={fmtUSD(earnings.paidUsd)} />
        </section>

        {/* Earnings */}
        <section style={{ marginTop: 40 }}>
          <h2 style={h2}>Earnings</h2>
          {earnings.txns.length === 0 ? (
            <div style={emptyCard}>
              No conversions yet. When someone subscribes with your code{" "}
              <b style={{ fontFamily: "var(--font-geist-mono), monospace" }}>{clipper.code}</b>, each
              payment shows up here with your {pct}% share.
            </div>
          ) : (
            <TableCard>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={{ ...th, textAlign: "right" }}>Net revenue</th>
                  <th style={{ ...th, textAlign: "right" }}>Your {pct}%</th>
                  <th style={{ ...th, textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {earnings.txns.slice(0, 100).map((t) => (
                  <tr key={t.transactionId} style={{ borderBottom: "1px solid #f5f1ea" }}>
                    <td style={{ ...td, ...num }}>{fmtDate(t.eventAt)}</td>
                    <td style={td}>{t.type === "INITIAL_PURCHASE" ? "New subscriber" : "Renewal"}</td>
                    <td style={{ ...td, ...num, textAlign: "right" }}>{fmtUSD(t.netUsd)}</td>
                    <td style={{ ...td, ...num, textAlign: "right", fontWeight: 600 }}>
                      {t.status === "refunded" ? "—" : fmtUSD(t.earningUsd)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <StatusBadge txn={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          )}
        </section>

        {/* Videos */}
        <section style={{ marginTop: 40 }}>
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <h2 style={{ ...h2, margin: 0 }}>Your videos</h2>
            <SubmitVideoForm token={token} />
          </div>
          <ConnectPage token={token} pageUrl={clipper.facebook_page_url} />
          {videos.length === 0 ? (
            <div style={emptyCard}>
              {clipper.facebook_page_url
                ? "No videos tracked yet. We check your page every day — new reels show up here automatically."
                : "No videos tracked yet. Connect your Facebook page above and we'll find your clips automatically, or paste a video link."}
            </div>
          ) : (
            <TableCard>
              <thead>
                <tr>
                  <th style={th}>Video</th>
                  <th style={th}>Platform</th>
                  <th style={th}>Posted</th>
                  <th style={{ ...th, textAlign: "right" }}>Views</th>
                  <th style={{ ...th, textAlign: "right" }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #f5f1ea" }}>
                    <td style={{ ...td, maxWidth: 320 }}>
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: ACCENT,
                          textDecoration: "none",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v.title?.trim() || v.url.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    </td>
                    <td style={{ ...td, textTransform: "capitalize" }}>{v.platform}</td>
                    <td style={{ ...td, ...num }}>{fmtDate(v.posted_at)}</td>
                    <td style={{ ...td, ...num, textAlign: "right", fontWeight: 600 }}>
                      {v.platform === "facebook" ? (
                        fmtInt(effectiveViews(v))
                      ) : (
                        // Only Facebook views are scraped — don't show a 0 that
                        // reads as "this flopped".
                        <span style={{ fontWeight: 400, color: MUTED }}>Not tracked</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontSize: 12, color: MUTED }}>
                      {fmtDate(v.views_updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          )}
        </section>

        {/* Payout history */}
        {payouts.length > 0 ? (
          <section style={{ marginTop: 40 }}>
            <h2 style={h2}>Payout history</h2>
            <TableCard>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f5f1ea" }}>
                    <td style={{ ...td, ...num }}>{fmtDate(p.paid_at)}</td>
                    <td style={{ ...td, color: MUTED }}>{p.note ?? p.method ?? ""}</td>
                    <td style={{ ...td, ...num, textAlign: "right", fontWeight: 600 }}>
                      {fmtUSD(Number(p.amount_usd))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          </section>
        ) : null}

        <footer
          style={{
            marginTop: 48,
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 20,
            fontSize: 12,
            lineHeight: 1.6,
            color: MUTED,
          }}
        >
          Figures are estimates and may adjust as store data settles. Payments become payable{" "}
          {HOLDBACK_DAYS} days after each transaction, exclude refunded purchases, and cover the
          first {REVSHARE_MONTHS_CAP} months of each subscriber. Revenue shares are calculated on
          net proceeds after app-store fees.
        </footer>
      </div>
    </main>
  );
}
