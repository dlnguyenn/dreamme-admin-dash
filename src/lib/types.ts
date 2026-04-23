import type { PersonaId } from "./personas";

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

export interface SavedCaption {
  id: string;
  sourceItemId: string | null;
  sourceHookId: string | null;
  personaId: PersonaId;
  caption: string;
  posted: boolean;
  starred: boolean;
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
