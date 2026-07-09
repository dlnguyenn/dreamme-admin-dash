/**
 * /clip/[token] — public per-clipper rev-share report ("public brand report"
 * style: stat tiles + tables). No login; the unguessable token IS the auth.
 *
 * Shows the clipper their videos + views, attributed conversions, and
 * estimated pay under the program rules: revshare_pct of net-of-Apple
 * proceeds, payable 30 days after each transaction, refunds excluded,
 * first 12 months per subscriber.
 *
 * Server component (creatives/page.tsx pattern): force-dynamic, service-role
 * reads via src/lib/clippers.ts, Tailwind utilities.
 */
import { notFound } from "next/navigation";
import {
  clippersDbConfigured,
  loadClipperBundle,
  effectiveViews,
  sbGet,
  HOLDBACK_DAYS,
  REVSHARE_MONTHS_CAP,
  type ClipperRow,
  type EarningTxn,
} from "@/lib/clippers";
import { fetchCreatorStatByCode } from "@/lib/appReferrals";
import { SubmitVideoForm } from "./submit-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtUSD(n: number, frac = 2): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: frac,
  });
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

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-neutral-400">{sub}</div> : null}
    </div>
  );
}

function StatusBadge({ txn }: { txn: EarningTxn }) {
  if (txn.status === "refunded") {
    return (
      <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">
        Refunded
      </span>
    );
  }
  if (txn.status === "pending") {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        Pending · {txn.daysLeft}d left
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
      Payable
    </span>
  );
}

export default async function ClipperPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!clippersDbConfigured() || !/^[a-f0-9]{16,64}$/i.test(token)) notFound();

  const clippers = await sbGet<ClipperRow[]>(
    `clippers?token=eq.${encodeURIComponent(token)}&active=eq.true&limit=1`,
  );
  const clipper = clippers[0];
  if (!clipper) notFound();

  const [{ videos, earnings, totalViews, payouts }, appStat] = await Promise.all([
    loadClipperBundle(clipper),
    fetchCreatorStatByCode(clipper.code),
  ]);
  // App referral system is authoritative for display name + conversion count;
  // fall back to local/priced values when the feed isn't connected.
  const displayName = appStat?.creator_name ?? clipper.name;
  const conversions = appStat?.purchased ?? earnings.conversions;

  return (
    <main className="min-h-screen bg-[#faf7f2] px-4 py-10 text-neutral-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-widest text-[#c96a4a]">
              DreamMe · Creator Report
            </div>
            <h1 className="mt-1 text-3xl font-semibold">{displayName}</h1>
          </div>
          <div className="rounded-xl border border-[#c96a4a]/30 bg-[#c96a4a]/10 px-4 py-2 text-sm">
            Your code: <span className="font-mono font-bold text-[#c96a4a]">{clipper.code}</span>
          </div>
        </header>

        {/* Stat tiles */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Total views" value={fmtInt(totalViews)} />
          <StatTile label="Videos" value={fmtInt(videos.length)} />
          <StatTile label="Conversions" value={fmtInt(conversions)} sub="subscribers via your code" />
          <StatTile label="Pending" value={fmtUSD(earnings.pendingUsd)} sub={`clears after ${HOLDBACK_DAYS} days`} />
          <StatTile label="Payable now" value={fmtUSD(earnings.balanceUsd > 0 ? earnings.balanceUsd : 0)} sub="after payouts to date" />
          <StatTile label="Paid to date" value={fmtUSD(earnings.paidUsd)} />
        </section>

        {/* Earnings */}
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Earnings</h2>
          {earnings.txns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 px-6 py-10 text-center text-sm text-neutral-500">
              No conversions yet. When someone subscribes with your code{" "}
              <span className="font-mono font-semibold">{clipper.code}</span>, each payment shows
              up here with your {Number(clipper.revshare_pct)}% share.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wider text-neutral-400">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 text-right font-medium">Net revenue</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Your {Number(clipper.revshare_pct)}%
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.txns.slice(0, 100).map((t) => (
                    <tr key={t.transactionId} className="border-b border-neutral-50 last:border-0">
                      <td className="px-4 py-2.5 tabular-nums">{fmtDate(t.eventAt)}</td>
                      <td className="px-4 py-2.5">
                        {t.type === "INITIAL_PURCHASE" ? "New subscriber" : "Renewal"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtUSD(t.netUsd)}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {t.status === "refunded" ? "—" : fmtUSD(t.earningUsd)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <StatusBadge txn={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Videos */}
        <section className="mt-10">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Your videos</h2>
            <SubmitVideoForm token={token} />
          </div>
          {videos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 px-6 py-10 text-center text-sm text-neutral-500">
              No videos tracked yet. We scan your Facebook page daily — or paste a video link
              above.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wider text-neutral-400">
                    <th className="px-4 py-3 font-medium">Video</th>
                    <th className="px-4 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium">Posted</th>
                    <th className="px-4 py-3 text-right font-medium">Views</th>
                    <th className="px-4 py-3 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-b border-neutral-50 last:border-0">
                      <td className="max-w-[320px] px-4 py-2.5">
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-[#c96a4a] hover:underline"
                        >
                          {v.title?.trim() || v.url.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 capitalize">{v.platform}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtDate(v.posted_at)}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {fmtInt(effectiveViews(v))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-neutral-400">
                        {fmtDate(v.views_updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Payout history */}
        {payouts.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold">Payout history</h2>
            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id} className="border-b border-neutral-50 last:border-0">
                      <td className="px-4 py-2.5 tabular-nums">{fmtDate(p.paid_at)}</td>
                      <td className="px-4 py-2.5 text-neutral-500">{p.note ?? p.method ?? ""}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {fmtUSD(Number(p.amount_usd))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <footer className="mt-12 border-t border-neutral-200 pt-5 text-xs leading-relaxed text-neutral-400">
          Figures are estimates and may adjust as store data settles. Payments become payable{" "}
          {HOLDBACK_DAYS} days after each transaction, exclude refunded purchases, and cover the
          first {REVSHARE_MONTHS_CAP} months of each subscriber. Revenue shares are calculated on
          net proceeds after app-store fees.
        </footer>
      </div>
    </main>
  );
}
