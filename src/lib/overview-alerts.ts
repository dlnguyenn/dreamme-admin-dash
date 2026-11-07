/**
 * "Needs attention": the urgent subset of every alert the DAD raises, pulled
 * to the top of the Overview so something broken is seen without visiting
 * the tab that knows about it.
 *
 * Urgent means broken or needing a person now. It deliberately does NOT
 * mean "unusual": marketing_alerts holds ~200 unresolved rows, many of them
 * "critical" good news (a CPI drop). Only the bad-direction critical ones
 * from the last 36 hours make it in.
 *
 * Rules live in buildUrgentAlerts (pure, tested); the fetchers below only
 * gather inputs and each fail independently (a failed lookup becomes an
 * alert of its own, never a silent "all clear").
 */
import { resolveMetaToken, getActiveConnection } from "@/lib/meta-oauth";
import { attentionFor, type StoreReviewRow } from "@/lib/store-reviews-shared";
import { sbCount, sbGet } from "@/lib/revenue-plan/db";
import type { OpsCheck } from "@/lib/overview";
import type { PaidDaily } from "@/lib/overview-paid";

const API_VERSION = process.env.META_API_VERSION ?? "v22.0";

export type UrgentLevel = "critical" | "warning";

/** Where the "Open" link goes: a DAD tab id, or an outside URL. */
export type UrgentLink = { tab: string; label: string } | { href: string; label: string };

export interface UrgentAlert {
  /** Stable per problem; with `fingerprint` it decides when a dismissal expires. */
  id: string;
  /** Changes when the problem changes, so a dismissed alert comes back. */
  fingerprint: string;
  level: UrgentLevel;
  title: string;
  detail: string;
  link?: UrgentLink;
}

// ---------------------------------------------------------------------------
// Inputs

export interface MarketingAlertInput {
  id: string;
  severity: string;
  metric: string | null;
  message: string;
  campaign_name: string | null;
  created_at: string;
}

export interface RejectedAd {
  id: string;
  name: string;
  status: string; // DISAPPROVED | WITH_ISSUES
  adsetName: string | null;
  reason: string | null;
}

export interface UrgentInputs {
  now: Date;
  /** Hours since midnight Eastern, fractional. */
  easternHour: number;
  ops: OpsCheck[] | null;
  /** Overview sections that failed to load ("paid: Supabase 500 …"). */
  sectionErrors: string[];
  northStar: { trialStartsToday: number | null; avg7d: number | null; stale: boolean } | null;
  paid: PaidDaily | null;
  /** null = lookup failed. */
  metaAccount: { status: number; disableReason: number } | null;
  metaAccountError: string | null;
  rejectedAds: RejectedAd[] | null;
  rejectedAdsError: string | null;
  adAccountId: string | null;
  metaTokenExpiresAt: string | null;
  marketingAlerts: MarketingAlertInput[] | null;
  urgentSupportUnread: number | null;
  urgentReviews: { store: string; rating: number; reasons: string[]; reviewedAt: string }[] | null;
}

// ---------------------------------------------------------------------------
// Rules (pure)

const ACCOUNT_STATUS: Record<number, string> = {
  2: "disabled",
  3: "unsettled (payment failed)",
  7: "pending risk review",
  8: "pending settlement",
  9: "in a grace period",
  100: "pending closure",
  101: "closed",
};

/** Bad-direction metrics: these words in the message mean worse delivery. */
const BAD_MOVES: Record<string, RegExp> = {
  cpi: /spike/i,
  cpm: /spike/i,
  ctr: /drop/i,
  spend: /drop|spike/i,
};

function relHours(h: number): string {
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildUrgentAlerts(i: UrgentInputs): UrgentAlert[] {
  const out: UrgentAlert[] = [];

  // 1. Pipelines that stopped producing data (Pipeline health).
  for (const c of i.ops ?? []) {
    if (c.state === "ok") continue;
    const badly = c.state === "missing" || (c.ageHours ?? 0) > c.expectHours * 2;
    out.push({
      id: `ops:${c.key}`,
      fingerprint: c.lastAt ?? "never",
      level: badly ? "critical" : "warning",
      title: `${c.label} isn't running`,
      detail:
        c.state === "missing"
          ? "No data found at all."
          : `Last data ${relHours(c.ageHours ?? 0)}; expected at least every ${c.expectHours}h.`,
    });
  }

  // 2. Overview sections that failed to load.
  for (const e of i.sectionErrors) {
    const name = e.split(":")[0];
    out.push({
      id: `section:${name}`,
      fingerprint: e,
      level: "warning",
      title: `Couldn't load ${name}`,
      detail: e.slice(name.length + 1).trim().slice(0, 200),
    });
  }

  // 3. Trials: the RevenueCat feed, and "nothing is converting today".
  const ns = i.northStar;
  if (ns?.stale) {
    out.push({
      id: "trials:stale",
      fingerprint: i.now.toISOString().slice(0, 10),
      level: "critical",
      title: "No RevenueCat trial events for yesterday",
      detail: "The RevenueCat webhook may be down, or purchases are failing. Check the RevenueCat dashboard.",
    });
  }
  if (ns && ns.trialStartsToday === 0 && ns.avg7d != null) {
    const expected = (ns.avg7d * i.easternHour) / 24;
    if (expected >= 6) {
      out.push({
        id: "trials:zero-today",
        fingerprint: i.now.toISOString().slice(0, 10),
        level: "critical",
        title: "No trials yet today",
        detail: `About ${Math.round(expected)} would be normal by now (${ns.avg7d}/day average). The paywall or purchase flow may be broken.`,
      });
    }
  }

  // 4. Meta: the account, the token, the live read, and delivery.
  if (i.metaAccount && i.metaAccount.status !== 1 && i.metaAccount.status !== 201) {
    out.push({
      id: "meta:account",
      fingerprint: `${i.metaAccount.status}/${i.metaAccount.disableReason}`,
      level: "critical",
      title: `Meta ad account is ${ACCOUNT_STATUS[i.metaAccount.status] ?? `in status ${i.metaAccount.status}`}`,
      detail: "Ads may not be delivering. Check Billing and Account Quality in Meta.",
      link: { href: "https://business.facebook.com/accountquality", label: "Account Quality" },
    });
  }
  if (i.metaAccountError) {
    out.push({
      id: "meta:read",
      fingerprint: i.metaAccountError,
      level: "critical",
      title: "The DAD can't read Meta",
      detail: `${i.metaAccountError.slice(0, 160)}. Spend, trials and ad checks are blind until it's reconnected.`,
      link: { tab: "integrations", label: "Integrations" },
    });
  } else if (i.paid?.metaSource === "synced" || (i.paid && i.paid.metaSource == null)) {
    out.push({
      id: "meta:live-insights",
      fingerprint: i.paid.metaError ?? "unknown",
      level: "warning",
      title: "Live Meta spend read is failing",
      detail: `${(i.paid.metaError ?? "unknown error").slice(0, 160)}. Today's spend is blank.`,
      link: { tab: "integrations", label: "Integrations" },
    });
  }
  if (i.metaTokenExpiresAt) {
    const days = (Date.parse(i.metaTokenExpiresAt) - i.now.getTime()) / 86_400_000;
    if (days < 7) {
      out.push({
        id: "meta:token",
        fingerprint: i.metaTokenExpiresAt,
        level: days < 2 ? "critical" : "warning",
        title: days <= 0 ? "Meta login has expired" : `Meta login expires in ${Math.max(1, Math.round(days))} days`,
        detail: "Reconnect Facebook on Integrations or every Meta read stops.",
        link: { tab: "integrations", label: "Integrations" },
      });
    }
  }
  const p = i.paid;
  if (p?.metaSource === "live" && p.today.spend === 0 && i.easternHour >= 9) {
    const avg = (p.last7.spend ?? 0) / 7;
    if (avg >= 100) {
      out.push({
        id: "meta:no-spend",
        fingerprint: p.today.date,
        level: "critical",
        title: "No Meta spend today",
        detail: `$0 so far against about $${Math.round(avg)}/day last week. Check billing, budgets and whether campaigns are on.`,
        link: { tab: "marketing", label: "Marketing Efficiency" },
      });
    }
  }
  if (i.rejectedAds && i.rejectedAds.length > 0) {
    const names = i.rejectedAds.map((a) => a.name).slice(0, 3).join("; ");
    const reasons = [...new Set(i.rejectedAds.map((a) => a.reason).filter(Boolean))].join(", ");
    const act = (i.adAccountId ?? "").replace(/^act_/, "");
    out.push({
      id: "meta:rejected-ads",
      fingerprint: i.rejectedAds.map((a) => `${a.id}:${a.status}`).sort().join(","),
      level: "warning",
      title: `${plural(i.rejectedAds.length, "ad")} rejected or with issues in live ad sets`,
      detail: `${names}${i.rejectedAds.length > 3 ? " …" : ""}${reasons ? ` (${reasons})` : ""}. Appeal, fix or turn off.`,
      link: act
        ? {
            href: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${i.rejectedAds.map((a) => a.id).join(",")}`,
            label: "Ads Manager",
          }
        : undefined,
    });
  }
  if (i.rejectedAdsError) {
    out.push({
      id: "meta:rejected-ads-read",
      fingerprint: i.rejectedAdsError,
      level: "warning",
      title: "Couldn't check for rejected ads",
      detail: i.rejectedAdsError.slice(0, 200),
    });
  }

  // 5. Marketing alerts: only critical, bad-direction, recent.
  const recent = (i.marketingAlerts ?? []).filter((a) => {
    if (i.now.getTime() - Date.parse(a.created_at) > 36 * 3_600_000) return false;
    if (a.metric === "plan_spend") return a.severity === "critical";
    const bad = a.metric ? BAD_MOVES[a.metric] : undefined;
    return a.severity === "critical" && !!bad && bad.test(a.message);
  });
  for (const a of recent) {
    out.push({
      id: `marketing:${a.id}`,
      fingerprint: a.id,
      level: a.metric === "spend" ? "critical" : "warning",
      title: a.campaign_name ? `${a.campaign_name}: ${a.metric ?? "alert"}` : `Ads: ${a.metric ?? "alert"}`,
      detail: a.message,
      link: { tab: "marketing", label: "Marketing Efficiency" },
    });
  }

  // 6. People waiting: urgent support mail, and reviews saying it's broken.
  if (i.urgentSupportUnread != null && i.urgentSupportUnread > 0) {
    out.push({
      id: "support:urgent",
      fingerprint: String(i.urgentSupportUnread),
      level: "warning",
      title: `${plural(i.urgentSupportUnread, "urgent support email")} unread`,
      detail: "Marked high urgency in the last 48 hours.",
      link: { tab: "support", label: "Support Inbox" },
    });
  }
  const reviews = i.urgentReviews ?? [];
  if (reviews.length > 0) {
    const broken = reviews.filter((r) => r.reasons.includes("broken")).length;
    out.push({
      id: "reviews:urgent",
      fingerprint: reviews.map((r) => r.reviewedAt).sort().join(","),
      level: "warning",
      title: `${plural(reviews.length, "new store review")} about ${broken > 0 ? "the app breaking" : "billing"}${broken > 0 && broken < reviews.length ? " or billing" : ""}`,
      detail: "Unanswered, from the last 3 days.",
      link: { tab: "reviews", label: "Store Reviews" },
    });
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Fetchers

type Settled<T> = { value: T | null; error: string | null };
const settle = async <T>(p: Promise<T>): Promise<Settled<T>> => {
  try {
    return { value: await p, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
};

let metaCache: { at: number; value: { account: Settled<{ status: number; disableReason: number }>; ads: Settled<RejectedAd[]>; accountId: string | null } } | null = null;

async function metaChecks() {
  if (metaCache && Date.now() - metaCache.at < 5 * 60_000) return metaCache.value;
  const meta = await resolveMetaToken().catch(() => null);
  if (!meta) {
    const err = "no Meta connection";
    return { account: { value: null, error: err }, ads: { value: null, error: null }, accountId: null };
  }
  const act = meta.account.startsWith("act_") ? meta.account : `act_${meta.account}`;
  const graph = async <T>(path: string, qs: Record<string, string>): Promise<T> => {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${path}?${new URLSearchParams(qs)}`, {
      headers: { Authorization: `Bearer ${meta.token}` },
      cache: "no-store",
    });
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok || body.error) throw new Error(`Meta ${res.status}: ${body.error?.message ?? "request failed"}`);
    return body;
  };
  const [account, ads] = await Promise.all([
    settle(
      graph<{ account_status: number; disable_reason: number }>(act, { fields: "account_status,disable_reason" }).then((b) => ({
        status: Number(b.account_status),
        disableReason: Number(b.disable_reason ?? 0),
      })),
    ),
    settle(
      graph<{
        data?: {
          id: string;
          name: string;
          status?: string;
          effective_status: string;
          adset?: { name?: string; effective_status?: string };
          ad_review_feedback?: { global?: Record<string, string> };
        }[];
      }>(`${act}/ads`, {
        fields: "id,name,status,effective_status,adset{name,effective_status},ad_review_feedback",
        effective_status: JSON.stringify(["DISAPPROVED", "WITH_ISSUES"]),
        limit: "200",
      }).then((b) =>
        (b.data ?? [])
          // Only where it costs us: an ad that is switched on, in an ad set
          // that is actually delivering. A rejected ad you've paused keeps
          // effective_status WITH_ISSUES forever, so `status` (the on/off
          // switch) is what says it's been dealt with.
          .filter((a) => a.status === "ACTIVE" && a.adset?.effective_status === "ACTIVE")
          .map((a) => ({
            id: a.id,
            name: a.name,
            status: a.effective_status,
            adsetName: a.adset?.name ?? null,
            reason: Object.keys(a.ad_review_feedback?.global ?? {})[0] ?? null,
          })),
      ),
    ),
  ]);
  const value = { account, ads, accountId: act };
  metaCache = { at: Date.now(), value };
  return value;
}

export function easternHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export async function collectUrgentAlerts(base: {
  now?: Date;
  ops: OpsCheck[] | null;
  sectionErrors: string[];
  northStar: UrgentInputs["northStar"];
  paid: PaidDaily | null;
}): Promise<UrgentAlert[]> {
  const now = base.now ?? new Date();
  const since36h = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  const since48h = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const since3d = new Date(now.getTime() - 3 * 86_400_000).toISOString();

  const [meta, conn, marketing, support, reviews] = await Promise.all([
    metaChecks(),
    settle(getActiveConnection()),
    settle(
      sbGet<MarketingAlertInput[]>(
        "internal",
        `marketing_alerts?select=id,severity,metric,message,campaign_name,created_at&resolved_at=is.null&created_at=gte.${since36h}&order=created_at.desc&limit=100`,
      ),
    ),
    settle(
      sbCount(
        "internal",
        `support_threads?select=id&unread=is.true&urgency=eq.high&last_inbound_at=gte.${since48h}`,
      ),
    ),
    settle(
      sbGet<StoreReviewRow[]>(
        "internal",
        `store_reviews?select=*&reviewed_at=gte.${since3d}&order=reviewed_at.desc&limit=200`,
      ),
    ),
  ]);

  const extraErrors: string[] = [];
  if (marketing.error) extraErrors.push(`marketing alerts: ${marketing.error}`);
  if (support.error) extraErrors.push(`support urgency: ${support.error}`);
  if (reviews.error) extraErrors.push(`store reviews: ${reviews.error}`);

  return buildUrgentAlerts({
    now,
    easternHour: easternHour(now),
    ops: base.ops,
    sectionErrors: [...base.sectionErrors, ...extraErrors],
    northStar: base.northStar,
    paid: base.paid,
    metaAccount: meta.account.value,
    metaAccountError: meta.account.error,
    rejectedAds: meta.ads.value,
    rejectedAdsError: meta.account.error ? null : meta.ads.error,
    adAccountId: meta.accountId,
    metaTokenExpiresAt: conn.value?.token_expires_at ?? null,
    marketingAlerts: marketing.value,
    urgentSupportUnread: support.value,
    urgentReviews: (reviews.value ?? [])
      .map((r) => ({ r, a: attentionFor(r) }))
      .filter(({ a }) => a.urgent)
      .map(({ r, a }) => ({ store: r.store, rating: r.rating, reasons: a.reasons, reviewedAt: r.reviewed_at })),
  });
}
