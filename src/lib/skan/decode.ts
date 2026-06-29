// Decode a raw SKAdNetwork / AdAttributionKit postback into the columns the
// dashboard reads: conversion-value -> event (via our CV schema) and
// source-identifier -> Meta campaign (via the mapping table).
//
// All decoding is data-driven (rows fetched from skan_cv_schema /
// skan_campaign_mapping) so the mapping can change without a code deploy.

export type DecodedEvent =
  | "trial_started"
  | "subscribed"
  | "purchase"
  | "complete_registration";

/** A row of our conversion-value -> event ladder. */
export interface CvSchemaRow {
  postback_sequence_index: number;
  value_kind: "fine" | "coarse";
  fine_value: number | null;
  coarse_value: string | null;
  event: string;
}

/** A row of the source-identifier -> Meta campaign mapping. */
export interface CampaignMapRow {
  network: string;
  source_identifier: string;
  meta_campaign_id: string | null;
  meta_campaign_name: string | null;
}

/** Normalized fields pulled out of the raw postback JSON. */
export interface ExtractedFields {
  network: string;
  version: string | null;
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
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return String(Math.trunc(v));
  return String(v);
}
function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * Pull the canonical fields out of a raw postback. Handles both SKAN 4.0
 * (source-identifier) and earlier (campaign-id) shapes. `network` distinguishes
 * the collector path the postback arrived on.
 */
export function extractFields(
  raw: Record<string, unknown>,
  network: string,
): ExtractedFields {
  const version = asStr(raw["version"]);
  const sourceId = asStr(raw["source-identifier"]);
  const campaignId = asStr(raw["campaign-id"]);
  return {
    network,
    version,
    ad_network_id: asStr(raw["ad-network-id"]),
    // SKAN<4 uses campaign-id; copy it into source_identifier so mapping +
    // grouping work uniformly across versions.
    source_identifier: sourceId ?? campaignId,
    campaign_id_raw: campaignId,
    app_id: asStr(raw["app-id"]),
    transaction_id: asStr(raw["transaction-id"]),
    redownload: asBool(raw["redownload"]),
    did_win: asBool(raw["did-win"]),
    fidelity_type: asNum(raw["fidelity-type"]),
    postback_sequence_index: asNum(raw["postback-sequence-index"]),
    conversion_value: asNum(raw["conversion-value"]),
    coarse_conversion_value: asStr(raw["coarse-conversion-value"]),
    source_app_id: asStr(raw["source-app-id"]),
    source_domain: asStr(raw["source-domain"]),
  };
}

/**
 * Map (window, conversion-value) -> event using our CV schema. Fine values
 * (P1, 0-63) take priority when present; otherwise fall back to the coarse
 * value (P2/P3 low/medium/high). Returns null for unmapped values (e.g. fine
 * values 0-59, which we intentionally don't assign).
 */
export function decodeEvent(
  fields: ExtractedFields,
  schema: CvSchemaRow[],
): string | null {
  const win = fields.postback_sequence_index;
  if (win == null) return null;

  if (fields.conversion_value != null) {
    const hit = schema.find(
      (r) =>
        r.value_kind === "fine" &&
        r.postback_sequence_index === win &&
        r.fine_value === fields.conversion_value,
    );
    if (hit) return hit.event;
  }
  if (fields.coarse_conversion_value != null) {
    const hit = schema.find(
      (r) =>
        r.value_kind === "coarse" &&
        r.postback_sequence_index === win &&
        r.coarse_value === fields.coarse_conversion_value,
    );
    if (hit) return hit.event;
  }
  return null;
}

/** Map the postback's source-identifier back to our Meta campaign (best-effort). */
export function mapCampaign(
  fields: ExtractedFields,
  mapping: CampaignMapRow[],
): { id: string | null; name: string | null; note: string | null } {
  if (fields.source_identifier == null) {
    return { id: null, name: null, note: "no source-identifier (nulled by privacy threshold)" };
  }
  const hit = mapping.find(
    (m) =>
      m.source_identifier === fields.source_identifier &&
      (m.network === fields.network || m.network === "skadnetwork"),
  );
  if (!hit) {
    return {
      id: null,
      name: null,
      note: `unmapped source-identifier ${fields.source_identifier}`,
    };
  }
  return { id: hit.meta_campaign_id, name: hit.meta_campaign_name, note: null };
}
