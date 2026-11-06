/**
 * In-house MMP parity: what AppsFlyer sells, module by module, against what
 * the DAD already runs. Pure: one mmp_snapshot row plus a clock go in, a
 * status and a line of live evidence per module come out.
 *
 * AppsFlyer facts are from its public docs, product and pricing pages only
 * (read 2026-11-05). Its terms of use bar reverse engineering its code, so
 * nothing here comes from the SDK binaries. Sources: wiki/mmp-emulation.md.
 */

/** One row of public.mmp_snapshot (migration 0098), numbers coerced. Counts are 35-day unless named otherwise. */
export interface MmpSnapshot {
  generated_at: string | null;
  trials: number;
  trials_ios: number;
  trials_android: number;
  trials_with_install: number;
  trials_click_matched: number;
  installs: number;
  installs_ios: number;
  installs_android: number;
  installs_matched: number;
  android_with_referrer: number;
  last_install_at: string | null;
  clicks: number;
  clicks_tagged: number;
  last_tagged_click_at: string | null;
  skan_postbacks: number;
  skan_valid: number;
  skan_trials: number;
  skan_cv_null: number;
  skan_redownloads: number;
  skan_view_through: number;
  skan_later_windows: number;
  skan_apple_ads: number;
  skan_unmapped: number;
  last_postback_at: string | null;
  meta_spend: number;
  meta_installs: number;
  meta_trials: number;
  meta_last_date: string | null;
  rc_paid: number;
  rc_revenue: number;
  sng_tracker_installs: number;
  sng_trials: number;
  sng_spend: number;
  sng_synced_at: string | null;
  capi_qualified: number;
  capi_qualified_sent: number;
  capi_qualified_last: string | null;
  capi_engaged: number;
  capi_engaged_last: string | null;
  capi_attr: number;
  capi_attr_last: string | null;
  tiktok_events: number;
  tiktok_events_sent: number;
  tiktok_cost_last_date: string | null;
  manual_spend_rows: number;
  aud_audiences: number;
  aud_suppression_members: number;
  aud_snapshot_rows: number;
  aud_snapshot_last_run: string | null;
  alerts_open: number;
  alerts_last_date: string | null;
  retention_cohorts: number;
  survey_total: number;
  survey_facebook: number;
  survey_instagram: number;
  survey_tiktok: number;
  survey_app_store: number;
}

/** One row of public.mmp_campaign_attribution, numbers coerced. */
export interface MmpCampaignRow {
  campaign_id: string;
  campaign_name: string | null;
  spend: number;
  meta_installs: number;
  meta_trials: number;
  /** null = SKAN decoded no trial for this campaign (Android, web, or nulled). */
  skan_trials: number | null;
  clicks: number;
  matched_installs: number;
  matched_trials: number;
  /** Singular's attributed installs and 7-day-cohort trials (Meta only). */
  singular_installs: number;
  singular_trials: number;
}

const DATE_KEYS = new Set<keyof MmpSnapshot>([
  "generated_at",
  "last_install_at",
  "last_tagged_click_at",
  "last_postback_at",
  "meta_last_date",
  "sng_synced_at",
  "capi_qualified_last",
  "capi_engaged_last",
  "capi_attr_last",
  "tiktok_cost_last_date",
  "aud_snapshot_last_run",
  "alerts_last_date",
]);

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** PostgREST sends numerics as strings; make every count a number and every date a string or null. */
export function toSnapshot(raw: Record<string, unknown>): MmpSnapshot {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = DATE_KEYS.has(k as keyof MmpSnapshot) ? (v == null ? null : String(v)) : toNum(v);
  }
  return out as unknown as MmpSnapshot;
}

export function toCampaignRow(raw: Record<string, unknown>): MmpCampaignRow {
  return {
    campaign_id: String(raw.campaign_id ?? ""),
    campaign_name: raw.campaign_name == null ? null : String(raw.campaign_name),
    spend: toNum(raw.spend),
    meta_installs: toNum(raw.meta_installs),
    meta_trials: toNum(raw.meta_trials),
    skan_trials: raw.skan_trials == null ? null : toNum(raw.skan_trials),
    clicks: toNum(raw.clicks),
    matched_installs: toNum(raw.matched_installs),
    matched_trials: toNum(raw.matched_trials),
    singular_installs: toNum(raw.singular_installs),
    singular_trials: toNum(raw.singular_trials),
  };
}

/**
 * live     running and producing data
 * partial  running, but covers only part of what AppsFlyer's version does
 * idle     built, with no traffic going through it
 * broken   built, and not doing its job
 * missing  not built, and nothing stops us building it
 * blocked  cannot be built: needs ad-network partner status
 * skip     not needed for how DreamMe buys ads
 */
export type ParityStatus = "live" | "partial" | "idle" | "broken" | "missing" | "blocked" | "skip";

export const STATUS_LABEL: Record<ParityStatus, string> = {
  live: "Live",
  partial: "Partial",
  idle: "Idle",
  broken: "Broken",
  missing: "Not built",
  blocked: "Can't copy",
  skip: "Not needed",
};

export const STATUS_ORDER: ParityStatus[] = ["live", "partial", "idle", "broken", "missing", "blocked", "skip"];

export type ParityArea =
  | "Attribution"
  | "SKAN"
  | "Events to networks"
  | "Cost and revenue"
  | "Fraud"
  | "Audiences"
  | "Incrementality"
  | "Data and reporting"
  | "Links";

export const AREAS: ParityArea[] = [
  "Attribution",
  "SKAN",
  "Events to networks",
  "Cost and revenue",
  "Audiences",
  "Incrementality",
  "Fraud",
  "Data and reporting",
  "Links",
];

export interface ParityRow {
  id: string;
  area: ParityArea;
  /** AppsFlyer's name for it. */
  name: string;
  /** What AppsFlyer's version does. */
  appsflyer: string;
  /** What the DAD has in its place. */
  ours: string;
  status: ParityStatus;
  /** Live numbers behind the status. */
  evidence: string;
  /** What closes the gap; empty when nothing is left. */
  next: string;
}

const DAY = 86_400_000;

/** Whole days between an ISO date or timestamp and now; null when there is no date. */
export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).getTime();
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY) : null;
}

const fresh = (iso: string | null, now: Date, maxDays: number) => {
  const d = daysSince(iso, now);
  return d != null && d <= maxDays;
};

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const share = (part: number, whole: number, digits = 0) => (whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : "—");
const day = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "never";

type Assess = (s: MmpSnapshot, now: Date) => { status: ParityStatus; evidence: string; next?: string };

interface ModuleDef extends Omit<ParityRow, "status" | "evidence"> {
  assess: Assess;
}

const MODULES: ModuleDef[] = [
  // ---- Attribution ------------------------------------------------------
  {
    id: "click-matching",
    area: "Attribution",
    name: "Click links and install matching",
    appsflyer:
      "Every ad carries an AppsFlyer link. The click is logged and the install is matched to the last click in a 7-day window: by referrer or device ID first, by a probabilistic match (up to 24 hours) otherwise.",
    ours: "go.dreamme.life/l logs the click and redirects to the store. The app's install ping is matched on IP, device fingerprint and time, last click wins, 7-day window.",
    next: "Only ads whose URL is the /l link can be matched, and App Promotion ads go straight to the store. It needs a website-objective campaign running.",
    assess: (s, now) => ({
      status: fresh(s.last_tagged_click_at, now, 7) ? "live" : "idle",
      evidence: `${int(s.clicks_tagged)} ad clicks and ${int(s.installs_matched)} matched installs in 35 days. Last ad click ${day(s.last_tagged_click_at)}.`,
    }),
  },
  {
    id: "srn",
    area: "Attribution",
    name: "Self-reporting networks (Meta, Google, TikTok)",
    appsflyer:
      "These networks don't use click links. AppsFlyer sends each install to the network's API, the network answers with a claim, and AppsFlyer picks the last touch across all claims. With Meta's Advanced Mobile Measurement terms it also gets row-level Meta attribution.",
    ours: "No claim API of our own. Singular, a certified Meta partner already in the app, has this access, and its reports are pulled in by campaign. Meta's own totals are read as a claim, not a fact.",
    next: "It can't be built in-house. Keep Singular's sync healthy, and test whether its reports break down by ad set and ad.",
    assess: (s) => ({
      status: s.sng_trials > 0 ? "partial" : "blocked",
      evidence: `Singular attributes ${int(s.sng_tracker_installs)} installs and ${int(s.sng_trials)} trials to Meta campaigns. Meta itself claims ${int(s.meta_trials)} trials, ${share(s.meta_trials, s.trials)} of the ${int(s.trials)} RevenueCat counted from every source.`,
    }),
  },
  {
    id: "android-referrer",
    area: "Attribution",
    name: "Android install referrer",
    appsflyer:
      "The Play Install Referrer gives a deterministic match with no device ID. Meta's own install referrer adds the campaign, ad set and ad, including installs that followed a view.",
    ours: "Not collected. The Android install ping carries no referrer.",
    next: "Read the Play and Meta install referrers in the Android install ping and decrypt Meta's with the key in the Meta app settings. Meta documents this for direct use, so no partner is needed.",
    assess: (s) => ({
      status: s.android_with_referrer > 0 ? "live" : "missing",
      evidence: `${int(s.installs_android)} Android installs in 35 days, ${int(s.android_with_referrer)} with a referrer. Android is ${share(s.trials_android, s.trials)} of trials.`,
      next: s.android_with_referrer > 0 ? "" : undefined,
    }),
  },
  {
    id: "apple-ads",
    area: "Attribution",
    name: "Apple Ads attribution",
    appsflyer: "Reads Apple's AdServices token on the device and asks Apple which campaign and keyword drove the install. Deterministic, no partner needed.",
    ours: "Not collected. Apple Ads shows up only as SKAN postbacks with no conversion value.",
    next: "Turn on AdServices token collection in the app (RevenueCat has a switch for it), or send the token with the install ping and ask Apple's API ourselves.",
    assess: (s) => ({
      status: "missing",
      evidence: `${int(s.skan_apple_ads)} Apple Ads SKAN postbacks in 35 days, none tied to a trial.`,
    }),
  },
  {
    id: "reinstalls",
    area: "Attribution",
    name: "Reinstalls and re-attribution",
    appsflyer: "A reinstall inside the re-attribution window (90 days by default) counts as a re-attribution, not a new install.",
    ours: "SKAN flags redownloads. The install ping can't tell a new install from a reinstall or an app update.",
    next: "Classify each install in the app's install ping as new, reinstall or update.",
    assess: (s) => ({
      status: "partial",
      evidence: `${share(s.skan_redownloads, s.skan_postbacks, 1)} of SKAN postbacks are redownloads.`,
    }),
  },
  {
    id: "view-through",
    area: "Attribution",
    name: "View-through attribution",
    appsflyer: "Impression links credit an install that followed a view with no click, inside a 1-day window. A click always beats a view.",
    ours: "Only through SKAN, which reports installs that followed a view. There are no impression links.",
    next: "Nothing to build for Meta, which reports its own views. The Android Meta referrer would add view-through there.",
    assess: (s) => ({
      status: "partial",
      evidence: `${int(s.skan_view_through)} of ${int(s.skan_postbacks)} SKAN postbacks (${share(s.skan_view_through, s.skan_postbacks)}) followed a view.`,
    }),
  },

  // ---- SKAN -------------------------------------------------------------
  {
    id: "skan-collect",
    area: "SKAN",
    name: "SKAN postback collection",
    appsflyer: "Receives a copy of Apple's postbacks, verifies and decodes them, and reports installs and conversion values per campaign.",
    ours: "Our own endpoint receives the copies, checks Apple's signature and decodes them per campaign (First-party SKAN on Marketing Efficiency).",
    next: "Keep the source ID mapping current when campaigns change.",
    assess: (s, now) => {
      const healthy = fresh(s.last_postback_at, now, 3) && s.skan_postbacks > 0 && s.skan_valid / s.skan_postbacks >= 0.99;
      return {
        status: !healthy ? "broken" : s.skan_unmapped > 0 ? "partial" : "live",
        evidence: `${int(s.skan_postbacks)} postbacks in 35 days, ${share(s.skan_valid, s.skan_postbacks)} signature-valid, ${int(s.skan_trials)} decoded trials${s.skan_unmapped > 0 ? `, ${int(s.skan_unmapped)} from unmapped campaigns` : ""}.`,
        next: healthy && s.skan_unmapped === 0 ? "" : undefined,
      };
    },
  },
  {
    id: "skan-schema",
    area: "SKAN",
    name: "SKAN Conversion Studio",
    appsflyer: "Sets which events and revenue ranges map to conversion values across the three SKAN 4 windows, with no app release.",
    ours: "The schema is set in Meta Events Manager and mirrored in skan_cv_schema. Only the first window reports, so SKAN shows trial starts and never paid conversions.",
    next: "Find out why windows 2 and 3 almost never arrive. That is where trial-to-paid would show.",
    assess: (s) => ({
      status: "partial",
      evidence: `${int(s.skan_later_windows)} of ${int(s.skan_postbacks)} postbacks came from windows 2 or 3.`,
    }),
  },
  {
    id: "skan-model",
    area: "SKAN",
    name: "SKAN modeled data",
    appsflyer: "Fills in conversion values Apple withheld with a statistical model, so nulled installs still count.",
    ours: "Not built. Nulled postbacks stay unknown, which is why SKAN trial counts read low.",
    next: "Spread RevenueCat's iOS trials across campaigns in proportion to SKAN installs, and label the result an estimate.",
    assess: (s) => ({
      status: "missing",
      evidence: `${int(s.skan_cv_null)} postbacks (${share(s.skan_cv_null, s.skan_postbacks)}) carry no conversion value. SKAN sees ${int(s.skan_trials)} of ${int(s.trials_ios)} iOS trials.`,
    }),
  },
  {
    id: "predict",
    area: "SKAN",
    name: "Predict (early value signal)",
    appsflyer: "Scores a user's likely value from the first 24 hours and encodes it in the SKAN conversion value, so networks can optimize on quality.",
    ours: "Two early-quality events sent to Meta server-side: trial_qualified (still renewing after 2 hours) and trial_engaged (logged something within 4 hours).",
    next: "No ad set optimizes on them yet. Confirm in Events Manager that they arrive before pointing one at them.",
    assess: (s, now) => ({
      status: fresh(s.capi_engaged_last, now, 2) ? "partial" : "broken",
      evidence: `${int(s.capi_engaged)} trial_engaged and ${int(s.capi_qualified_sent)} trial_qualified events in 35 days.`,
    }),
  },

  // ---- Events to networks ----------------------------------------------
  {
    id: "postbacks-meta",
    area: "Events to networks",
    name: "In-app events back to Meta",
    appsflyer: "One SDK event is forwarded to every connected network as a postback, so each can optimize on it.",
    ours: "The Meta SDK fires events on the device, RevenueCat sends purchases to Meta's Conversions API, and the DAD sends trial_qualified every 15 minutes.",
    next: "",
    assess: (s, now) => ({
      status: fresh(s.capi_qualified_last, now, 2) ? "live" : "broken",
      evidence: `${int(s.capi_qualified_sent)} of ${int(s.capi_qualified)} trial_qualified events sent in 35 days. Last ${day(s.capi_qualified_last)}.`,
      next: fresh(s.capi_qualified_last, now, 2) ? "" : "The trial_qualified sender has stopped. Check the GitHub Actions cron.",
    }),
  },
  {
    id: "postbacks-tiktok",
    area: "Events to networks",
    name: "In-app events back to TikTok",
    appsflyer: "The same forwarding, to TikTok.",
    ours: "Written in August: RevenueCat events queue in an outbox and a cron posts them to TikTok's Events API. The sender was never deployed.",
    next: "Deploy the sender and pass TikTok's verification before any TikTok app campaign runs.",
    assess: (s) => ({
      status: s.tiktok_events_sent > 0 ? "live" : "idle",
      evidence: `${int(s.tiktok_events)} events queued and ${int(s.tiktok_events_sent)} sent, ever.`,
      next: s.tiktok_events_sent > 0 ? "" : undefined,
    }),
  },

  // ---- Cost and revenue -------------------------------------------------
  {
    id: "cost",
    area: "Cost and revenue",
    name: "Cost aggregation (Xpend, ROI360)",
    appsflyer: "Pulls spend from every network into one table, next to attributed installs and revenue.",
    ours: "Meta spend syncs daily into the cross-network cost table. TikTok and Apple Ads spend is not synced; a manual entry table exists.",
    next: "Add an Apple Ads spend sync from the existing API client. TikTok only matters once TikTok ads run.",
    assess: (s, now) => ({
      status: fresh(s.meta_last_date, now, 2) ? "partial" : "broken",
      evidence: `Meta ${usd(s.meta_spend)} in 35 days, synced through ${day(s.meta_last_date)}. TikTok cost last synced ${day(s.tiktok_cost_last_date)}. ${int(s.manual_spend_rows)} manual entries.`,
    }),
  },
  {
    id: "revenue",
    area: "Cost and revenue",
    name: "Subscription revenue per user",
    appsflyer: "Validates store purchases and ties trials, renewals and refunds to the attributed install.",
    ours: "RevenueCat webhooks land in rc_events, and the app stamps each customer with our install ID.",
    next: "",
    assess: (s) => {
      const ok = s.trials > 0 && s.trials_with_install / s.trials >= 0.9;
      return {
        status: ok ? "live" : "partial",
        evidence: `${int(s.trials_with_install)} of ${int(s.trials)} trials carry an install ID (${share(s.trials_with_install, s.trials)}).`,
        next: ok ? "" : "Trials without an install ID come from app versions older than 1.5.2.",
      };
    },
  },
  {
    id: "cohorts",
    area: "Cost and revenue",
    name: "LTV, cohort and retention reports",
    appsflyer: "Cohort charts by install date and media source: retention, revenue and ROI over time.",
    ours: "LTV cohorts, payback and payer retention on Marketing Efficiency. Every campaign shares the account-wide trial-to-paid rate, and retention reads a customer snapshot.",
    next: "Per-campaign rates need attributed trials. Retention needs the customer snapshot running again.",
    assess: (s, now) => ({
      status: "partial",
      evidence: `${int(s.retention_cohorts)} retention cohorts. Customer snapshot last ran ${day(s.aud_snapshot_last_run)}${fresh(s.aud_snapshot_last_run, now, 10) ? "" : ", so they are stale"}.`,
    }),
  },

  // ---- Audiences --------------------------------------------------------
  {
    id: "audiences",
    area: "Audiences",
    name: "Audiences",
    appsflyer: "Builds user segments and pushes them to ad networks for suppression, lookalikes and win-back.",
    ours: "A weekly cron syncs active subscribers (suppression), a high-LTV seed and lapsed users to Meta by hashed email.",
    next: "",
    assess: (s, now) => {
      const ok = fresh(s.aud_snapshot_last_run, now, 10) && s.aud_suppression_members > 0;
      return {
        status: ok ? "live" : "broken",
        evidence: `Customer snapshot has ${int(s.aud_snapshot_rows)} rows, last run ${day(s.aud_snapshot_last_run)}. The suppression audience shows ${int(s.aud_suppression_members)} members.`,
        next: ok ? "" : "Fix the weekly sync. With an empty suppression audience, ads are not excluding people who already subscribe.",
      };
    },
  },

  // ---- Incrementality ---------------------------------------------------
  {
    id: "incrementality",
    area: "Incrementality",
    name: "Incrementality",
    appsflyer: "Holds out a control group and reports lift and cost per incremental install.",
    ours: "The Meta Switchback tab: planned high and low spend phases, iOS against Android as the control, cost per extra trial.",
    next: "Run a full-length switchback. The October run held for two days.",
    assess: () => ({
      status: "live",
      evidence: "The current read is on the Meta Switchback tab.",
    }),
  },

  // ---- Fraud ------------------------------------------------------------
  {
    id: "fraud",
    area: "Fraud",
    name: "Fraud protection (Protect360)",
    appsflyer: "Blocks fake installs using click-to-install time, click flooding, device farms, IP denylists and signed SDK messages.",
    ours: "Apple's signature check on every SKAN postback, the redownload rate, and a fingerprint conflict gate in the click matcher.",
    next: "Low priority: this fraud targets click-link ad networks, and paid spend is on Meta. Add click-to-install time checks before buying from any ad network.",
    assess: (s) => ({
      status: "partial",
      evidence: `${share(s.skan_valid, s.skan_postbacks)} of postbacks pass Apple's signature check.`,
    }),
  },

  // ---- Data and reporting ----------------------------------------------
  {
    id: "raw-data",
    area: "Data and reporting",
    name: "Raw data (Data Locker, Pull and Push APIs)",
    appsflyer: "Exports row-level installs, events and postbacks to your own storage, with daily quotas on the pull API.",
    ours: "The rows are already ours: clicks, installs, postbacks and RevenueCat events sit in Supabase.",
    next: "",
    assess: (s) => ({
      status: "live",
      evidence: `${int(s.installs)} installs, ${int(s.clicks)} clicks and ${int(s.skan_postbacks)} postbacks stored in 35 days.`,
    }),
  },
  {
    id: "alerts",
    area: "Data and reporting",
    name: "Dashboards and anomaly alerts",
    appsflyer: "Dashboards, plus alerts when a metric moves outside its normal range.",
    ours: "Marketing Efficiency, and a daily cron that flags spend, CPI, CTR and CPM anomalies.",
    next: "",
    assess: (s, now) => {
      const running = fresh(s.alerts_last_date, now, 3);
      const piled = s.alerts_open > 50;
      return {
        status: !running ? "broken" : piled ? "partial" : "live",
        evidence: `${int(s.alerts_open)} unresolved alerts. Newest ${day(s.alerts_last_date)}.`,
        next: !running ? "The alert cron has stopped." : piled ? "Alerts pile up unread. Auto-resolve old ones or raise the threshold." : "",
      };
    },
  },
  {
    id: "creative",
    area: "Data and reporting",
    name: "Creative optimization",
    appsflyer: "Ranks creatives by installs, cost and fatigue across networks.",
    ours: "The Creatives tab and ad breakdowns, on Meta's own trial counts.",
    next: "Ad-level truth needs matched installs or the Android referrer.",
    assess: (s) => ({
      status: "partial",
      evidence: `${int(s.trials_click_matched)} of ${int(s.trials)} trials in 35 days are tied to an ad by our own match.`,
    }),
  },
  {
    id: "ai",
    area: "Data and reporting",
    name: "MCP server and AI assistant",
    appsflyer: "An MCP server and assistant that answer questions from attribution data.",
    ours: "The dreamme-ads MCP and the Growth AI tab read the same tables as this page.",
    next: "",
    assess: () => ({ status: "live", evidence: "Both read live data." }),
  },
  {
    id: "privacy",
    area: "Data and reporting",
    name: "Aggregated Advanced Privacy",
    appsflyer: "Hides row-level data for iOS users who declined tracking and sends partners aggregated postbacks instead.",
    ours: "Nothing row-level leaves our own database, so there is nothing to aggregate.",
    next: "",
    assess: () => ({ status: "skip", evidence: "No third party receives our rows." }),
  },

  // ---- Links ------------------------------------------------------------
  {
    id: "onelink",
    area: "Links",
    name: "OneLink (deep links, QR and referral links)",
    appsflyer: "One link that routes by device, survives the store install and tells the app who referred the user.",
    ours: "The /l link picks the right store and logs the click. It carries nothing into the app; creators use typed codes.",
    next: "On Android a click ID can ride the Play referrer into the app. On iOS a typed code stays the fallback.",
    assess: (s) => ({
      status: "partial",
      evidence: `${int(s.clicks)} link clicks in 35 days.`,
    }),
  },
  {
    id: "web-to-app",
    area: "Links",
    name: "Web-to-app measurement",
    appsflyer: "A web SDK ties a web visit to the later app install and purchase.",
    ours: "The /l page captures Meta's browser IDs, and matched installs send Lead, trial and subscribe to Meta as website events.",
    next: "Same gate as click matching: it only runs while a website-objective campaign does.",
    assess: (s, now) => ({
      status: fresh(s.capi_attr_last, now, 7) ? "live" : "idle",
      evidence: `${int(s.capi_attr)} website events sent in 35 days. Last ${day(s.capi_attr_last)}.`,
    }),
  },
];

/** Every AppsFlyer module with its DAD status, in catalogue order. */
export function buildParity(s: MmpSnapshot, now: Date = new Date()): ParityRow[] {
  return MODULES.map(({ assess, ...def }) => {
    const a = assess(s, now);
    return { ...def, status: a.status, evidence: a.evidence, next: a.next ?? def.next };
  });
}

export function scoreboard(rows: ParityRow[]): Record<ParityStatus, number> {
  const out = Object.fromEntries(STATUS_ORDER.map((k) => [k, 0])) as Record<ParityStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}

export interface CoverageRow {
  id: string;
  label: string;
  /** Count shown at the right of the bar. */
  value: number;
  /** What the bar is a share of. */
  of: number;
  note: string;
}

/** How many of the 35-day trials each attribution method can see. */
export function coverage(s: MmpSnapshot): CoverageRow[] {
  return [
    { id: "rc", label: "RevenueCat (the truth)", value: s.trials, of: s.trials, note: "Every trial, from every source. No campaign attached." },
    { id: "install", label: "Carry our install ID", value: s.trials_with_install, of: s.trials, note: "Revenue can be joined to an install, if the install is attributed." },
    { id: "meta", label: "Claimed by Meta", value: s.meta_trials, of: s.trials, note: "Meta's own count, by campaign and ad. Includes view-through, and over-claims." },
    { id: "skan", label: "Decoded from SKAN", value: s.skan_trials, of: s.trials, note: "iOS only, by campaign. Apple withholds the rest." },
    { id: "click", label: "Matched to an ad click", value: s.trials_click_matched, of: s.trials, note: "Our own click match, down to the ad. Website-objective campaigns only." },
    { id: "singular", label: "Attributed by Singular", value: s.sng_trials, of: s.trials, note: "The MMP already in the app, a certified Meta partner. By campaign, iOS." },
  ];
}

export interface SingularRead {
  status: ParityStatus;
  evidence: string;
}

/**
 * Singular's SDK ships in the app and a daily cron pulls its reports.
 * Live needs trials; cost missing on top of that is partial.
 */
export function singularRead(s: MmpSnapshot, now: Date = new Date()): SingularRead {
  const synced = fresh(s.sng_synced_at, now, 2);
  return {
    status: !synced ? "broken" : s.sng_trials === 0 ? "idle" : s.sng_spend > 0 ? "live" : "partial",
    evidence: `${int(s.sng_tracker_installs)} installs and ${int(s.sng_trials)} trials attributed to Meta campaigns in 35 days, with ${usd(s.sng_spend)} of cost. Last sync ${day(s.sng_synced_at)}.`,
  };
}
