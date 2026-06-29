// Server-only data access for the SKAN collector. Uses the Supabase service
// role (the raw skan_postbacks table is RLS-locked to deny anon), via the same
// raw-PostgREST pattern the cron routes use.

import type { CampaignMapRow, CvSchemaRow } from "./decode";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";

export function skanStoreConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function fetchCvSchema(): Promise<CvSchemaRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/skan_cv_schema?select=postback_sequence_index,value_kind,fine_value,coarse_value,event`,
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`skan_cv_schema read failed: ${res.status}`);
  return res.json();
}

export async function fetchCampaignMapping(): Promise<CampaignMapRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/skan_campaign_mapping?select=network,source_identifier,meta_campaign_id,meta_campaign_name`,
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`skan_campaign_mapping read failed: ${res.status}`);
  return res.json();
}

export interface PostbackInsert {
  network: string;
  version: string | null;
  raw: Record<string, unknown>;
  ad_network_id: string | null;
  source_identifier: string | null;
  campaign_id_raw: string | null;
  app_id: string | null;
  transaction_id: string | null;
  redownload: boolean | null;
  did_win: boolean | null;
  fidelity_type: number | null;
  postback_sequence_index: number | null;
  conversion_value: number | null;
  coarse_conversion_value: string | null;
  source_app_id: string | null;
  source_domain: string | null;
  signature_status: string;
  decoded_event: string | null;
  mapped_campaign_id: string | null;
  mapped_campaign_name: string | null;
  decode_notes: string | null;
}

export type InsertResult = "stored" | "duplicate" | "error";

/**
 * Insert one postback. The partial unique index on
 * (network, transaction_id, postback_sequence_index) makes resends idempotent:
 * a duplicate raises 23505, which we report as "duplicate" rather than an error.
 */
export async function insertPostback(row: PostbackInsert): Promise<InsertResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/skan_postbacks`, {
    method: "POST",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  if (res.ok) return "stored";
  if (res.status === 409) return "duplicate";
  const body = await res.text().catch(() => "");
  if (body.includes("23505") || body.includes("duplicate key")) return "duplicate";
  throw new Error(`skan_postbacks insert failed: ${res.status} ${body}`);
}
