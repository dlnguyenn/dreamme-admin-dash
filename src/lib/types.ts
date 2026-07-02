import type { PersonaId } from "./personas";
import type { AvatarId } from "./avatars";
import type { PoseId } from "./poses";

export interface Delivery {
  id: string;
  personaId: PersonaId;
  imageUrl: string;
  caption: string;
  posted: boolean;
  starred: boolean;
  inLibrary: boolean;
  isBefore: boolean;
  createdAt: string;
}

export type CaptionPlatform = "tiktok" | "instagram";

export interface SavedCaption {
  id: string;
  sourceItemId: string | null;
  sourceHookId: string | null;
  personaId: PersonaId;
  caption: string;
  posted: boolean;
  starred: boolean;
  platform: CaptionPlatform;
  createdAt: string;
}

export interface DashState {
  items: Delivery[];
  savedCaptions: SavedCaption[];
}

export interface DeliveryRow {
  id: string;
  persona: PersonaId;
  image_url: string;
  caption: string;
  posted: boolean | null;
  starred: boolean | null;
  in_library: boolean | null;
  is_before: boolean | null;
  created_at: string;
}

export interface SavedCaptionRow {
  id: string;
  source_delivery_id: string | null;
  source_hook_id: string | null;
  persona: PersonaId;
  caption: string;
  posted: boolean | null;
  starred: boolean | null;
  platform: CaptionPlatform | null;
  created_at: string;
}

export interface GeneratedCaption {
  id: string;
  hookId: string | null;
  personaId: PersonaId;
  caption: string;
  model: string;
  notes: string | null;
  tipPoolAware: boolean;
  createdAt: string;
}

export interface GeneratedCaptionRow {
  id: string;
  hook_id: string | null;
  persona: PersonaId;
  caption: string;
  model: string;
  notes: string | null;
  tip_pool_aware: boolean | null;
  created_at: string;
}

export interface TikTokPostRow {
  id: string;
  persona: PersonaId;
  post_id: string | null;
  post_url: string;
  posted_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  caption: string | null;
  first_slide_url: string | null;
  first_slide_text: string | null;
  hook_normalized: string | null;
  category: string | null;
  last_scraped_at: string;
  created_at: string;
  performance_ratio: number | null;
  performance_class: "flop" | "mid" | "hit" | null;
}

export interface TikTokPost {
  id: string;
  personaId: PersonaId;
  postUrl: string;
  postedAt: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  performanceRatio: number | null;
  performanceClass: "flop" | "mid" | "hit" | null;
  caption: string;
  firstSlideUrl: string;
  firstSlideText: string;
  hookNormalized: string;
  category: string;
  createdAt: string;
}

export interface GeneratedHookRow {
  id: string;
  persona: PersonaId;
  hook_text: string;
  rationale: string | null;
  category: string | null;
  inspired_by_post_ids: string[];
  used: boolean;
  created_at: string;
  posted_post_id: string | null;
  deployed_at: string | null;
  match_confidence: number | null;
  match_source: "auto_normalized" | "auto_embedding" | "manual" | null;
}

export interface GeneratedHook {
  id: string;
  personaId: PersonaId;
  hookText: string;
  rationale: string;
  category: string;
  inspiredByPostIds: string[];
  used: boolean;
  createdAt: string;
  postedPostId: string | null;
  deployedAt: string | null;
  matchConfidence: number | null;
  matchSource: "auto_normalized" | "auto_embedding" | "manual" | null;
}

export type SpendVendor =
  | "anthropic"
  | "google"
  | "apify"
  | "vercel"
  | "supabase"
  | "business_cc"
  | "other";

export type SpendCategory = "ai" | "business";
export type SpendSource = "api" | "manual" | "csv";

export interface SpendLineItemRow {
  id: string;
  vendor: SpendVendor;
  category: SpendCategory;
  amount_usd: string | number;
  period_start: string;
  period_end: string;
  source: SpendSource;
  metadata: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
}

export interface SpendLineItem {
  id: string;
  vendor: SpendVendor;
  category: SpendCategory;
  amountUsd: number;
  periodStart: string;
  periodEnd: string;
  source: SpendSource;
  metadata: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
}

/**
 * One day from the `blended_marketing_efficiency` Postgres view: daily Meta
 * spend joined to RevenueCat account economics, with 7-day rolling MER,
 * net-new subs and MRR growth precomputed. Read-only; numeric columns come
 * back from PostgREST as strings, so coerce with Number() at the call site.
 */
export interface BlendedEfficiencyRow {
  date: string;
  meta_spend: string | number;
  revenue: string | number;
  mrr: string | number;
  active_subscriptions: number;
  new_customers: number;
  trial_starts: number;
  trial_conversions: number;
  mer_daily: string | number | null;
  meta_spend_7d: string | number | null;
  revenue_7d: string | number | null;
  mer_7d: string | number | null;
  net_new_subs_7d: number | null;
  mrr_growth_7d: string | number | null;
}

// One row per Meta campaign from the first-party SKAN/AdAttributionKit pipeline
// (public.skan_campaign_efficiency). Counts are decoded from signature-verified,
// did-win postbacks; spend is joined from ad_insights_daily. Numeric columns
// arrive from PostgREST as strings. campaign_id/name/source_identifier are null
// when the postback's source-identifier couldn't be mapped to a named campaign
// (privacy-nulled or not yet in skan_campaign_mapping).
export interface SkanCampaignEfficiencyRow {
  campaign_key: string;
  campaign_id: string | null;
  campaign_name: string | null;
  source_identifier: string | null;
  skan_trials: number;
  skan_subscribes: number;
  skan_purchases: number;
  trials_p1: number;
  trials_p2: number;
  trials_p3: number;
  subs_p1: number;
  subs_p2: number;
  subs_p3: number;
  spend: string | number | null;
  cost_per_skan_trial: string | number | null;
  cost_per_skan_subscribe: string | number | null;
  postbacks: number;
  last_postback_at: string | null;
}

// Single-row reconciliation of SKAN-derived totals against RevenueCat (the
// source of truth for absolute counts). public.skan_reconciliation.
export interface SkanReconciliationRow {
  skan_trials: number;
  skan_subscribes: number;
  meta_spend_35d: string | number | null;
  rc_trials_35d: number | null;
  rc_subscribes_35d: number | null;
  blended_cac_35d: string | number | null;
}

// Anomaly alerts from public.marketing_alerts (written daily by
// /api/cron/marketing-alerts — Singular-style spend/CPI/CTR/CPM anomalies).
export interface MarketingAlertRow {
  id: string;
  alert_date: string;
  scope: "account" | "campaign";
  campaign_id: string | null;
  campaign_name: string | null;
  metric: string;
  value: string | number | null;
  baseline: string | number | null;
  z: string | number | null;
  direction: "spike" | "drop" | null;
  severity: "info" | "warn" | "critical";
  message: string;
  created_at: string;
  resolved_at: string | null;
}

// AppsFlyer-style weekly payer retention cohorts from
// public.payer_retention_cohorts (fed by rc_customer_snapshot; empty until the
// first audience-sync run populates the snapshot).
export interface PayerRetentionCohortRow {
  cohort_week: string;
  payers: number;
  active_now: number;
  lapsed: number;
  retention_rate: string | number | null;
  avg_tenure_days: string | number | null;
}

// Protect360-lite postback health from public.skan_health.
export interface SkanHealthRow {
  postbacks_total: number;
  sig_valid: number;
  sig_invalid_or_unverified: number;
  did_not_win: number;
  redownloads: number;
  redownload_rate: string | number | null;
  click_through: number;
  view_through: number;
  first_postback_at: string | null;
  last_postback_at: string | null;
}

// LTV:CAC payback verdict from public.payback_summary (30d LTV — conservative
// vs lifetime).
export interface PaybackSummaryRow {
  blended_cac_per_trial_35d: string | number | null;
  blended_cac_per_sub_35d: string | number | null;
  ltv_30d_per_payer: string | number | null;
  ltv30_to_cac: string | number | null;
  payback_verdict: string | null;
}

// Module 1 — Cross-Network Cost. One row per (channel, campaign) over 35d from
// public.cross_network_campaign_efficiency. Trial/purchase/revenue counts are
// NETWORK-REPORTED (unreliable on iOS — networks under-report); use for relative
// ranking, not absolute CAC. Numeric columns arrive from PostgREST as strings.
export interface CrossNetworkCampaignRow {
  channel: string; // 'meta' | 'tiktok' | manual channel name
  campaign_id: string;
  campaign_name: string | null;
  spend: string | number | null;
  installs: number;
  network_trials: number;
  network_purchases: number;
  network_revenue: string | number | null;
  cost_per_trial: string | number | null;
  cac: string | number | null;
  roas: string | number | null;
}

// Single-row blended truth: total cross-network spend ÷ RevenueCat economics.
// public.cross_network_blended. network_trial_coverage = network ÷ RC trials
// (how small a fraction of real trials the networks actually report on iOS).
export interface CrossNetworkBlendedRow {
  total_spend_35d: string | number | null;
  network_trials_35d: number;
  rc_trials_35d: number;
  rc_subscribes_35d: number;
  rc_revenue_35d: string | number | null;
  blended_cac_per_trial_35d: string | number | null;
  blended_cac_per_sub_35d: string | number | null;
  blended_roas_35d: string | number | null;
  network_trial_coverage: string | number | null;
}

// Module 2 — LTV / retention cohort per campaign (35d) from
// public.campaign_ltv_cohorts. `source` says where the trial->paid rate came
// from: 'rc_actual' (per-ad RC with conversions) > 'skan_proxy' (SKAN P2) >
// 'account_blended' (account-level fallback, used today). The view auto-enriches
// to better sources with no code change. Per-campaign trial counts are an
// attributed subset — rank by predicted LTV, not absolute CAC.
export interface CampaignLtvCohortRow {
  campaign_id: string | null;
  campaign_name: string | null;
  spend: string | number | null;
  trials: number;
  trial_to_paid: string | number | null;
  ltv_per_payer: string | number | null;
  predicted_ltv_per_trial: string | number | null;
  cost_per_trial: string | number | null;
  source: "rc_actual" | "skan_proxy" | "account_blended";
}

export type ResourceKind = "image" | "link";

export interface ReferenceSlide {
  imageUrl: string;
  note: string;
}

export interface ReferenceSlideRow {
  image_url: string;
  note: string;
}

export interface ResourceReferenceRow {
  id: string;
  tiktok_url: string;
  title: string | null;
  caption: string | null;
  author_username: string | null;
  slides: ReferenceSlideRow[] | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceReference {
  id: string;
  tiktokUrl: string;
  title: string;
  caption: string;
  authorUsername: string;
  slides: ReferenceSlide[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceRow {
  id: string;
  kind: ResourceKind;
  title: string;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  tags: string[] | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  kind: ResourceKind;
  title: string;
  description: string;
  imageUrl: string | null;
  linkUrl: string | null;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type FeatureRequestStatus =
  | "new"
  | "planned"
  | "in_progress"
  | "shipped"
  | "declined";

export interface FeatureRequestRow {
  id: string;
  title: string;
  description: string;
  status: FeatureRequestStatus;
  epic: string | null;
  submitter_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureRequest {
  id: string;
  title: string;
  description: string;
  status: FeatureRequestStatus;
  epic: string | null;
  submitterEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarRow {
  name: string;
  image_url: string | null;
  updated_at: string;
}

export interface Avatar {
  name: AvatarId;
  imageUrl: string | null;
  updatedAt: string;
}

export interface PoseRow {
  name: string;
  image_url: string | null;
  updated_at: string;
}

export interface Pose {
  name: PoseId;
  imageUrl: string | null;
  updatedAt: string;
}
