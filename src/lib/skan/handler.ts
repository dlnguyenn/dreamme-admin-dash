// Shared collector logic for the SKAN + AdAttributionKit postback routes.
//
// The network is carried in the ROUTE PATH (one route file per network), not a
// query param: Next.js doesn't reliably forward a rewrite destination's query
// string to a route handler when the rewrite source has a dynamic segment, so
// `/api/skan/skadnetwork` and `/api/skan/adattributionkit` each call this with
// their network fixed.

import { NextResponse } from "next/server";
import { verifySkanSignature } from "./verify";
import {
  decodeEvent,
  extractFields,
  mapCampaign,
  type CampaignMapRow,
  type CvSchemaRow,
} from "./decode";
import {
  fetchCampaignMapping,
  fetchCvSchema,
  insertPostback,
  skanStoreConfigured,
  type PostbackInsert,
} from "./server";

export type Network = "skadnetwork" | "adattributionkit";

// Small in-process cache so we don't re-read the (tiny, rarely-changed) CV
// schema + campaign mapping on every postback. Postback volume is low and
// bursty; a 60s TTL keeps decode fresh without hammering PostgREST.
let cache: { at: number; schema: CvSchemaRow[]; mapping: CampaignMapRow[] } | null = null;
const CACHE_TTL_MS = 60_000;

async function getDecodeConfig(): Promise<{
  schema: CvSchemaRow[];
  mapping: CampaignMapRow[];
}> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { schema: cache.schema, mapping: cache.mapping };
  }
  const [schema, mapping] = await Promise.all([fetchCvSchema(), fetchCampaignMapping()]);
  cache = { at: Date.now(), schema, mapping };
  return { schema, mapping };
}

export async function collectPostback(
  req: Request,
  network: Network,
): Promise<Response> {
  if (!skanStoreConfigured()) {
    // Don't make Apple retry forever against a misconfigured endpoint.
    return NextResponse.json({ ok: false, error: "collector not configured" }, { status: 503 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const fields = extractFields(raw, network);

  // SKAN postbacks carry Apple's detached ECDSA attribution-signature (fully
  // verifiable). AdAttributionKit (iOS 17.4+) is migrating to JWS-signed
  // postbacks whose key/format we don't yet pin, so AAK is stored + decoded but
  // flagged "unverified_aak" (and therefore not counted) unless it happens to
  // verify under the SKAN scheme.
  let signature_status = verifySkanSignature(raw) as string;
  if (network === "adattributionkit" && signature_status !== "valid") {
    signature_status = "unverified_aak";
  }

  let decoded_event: string | null = null;
  let mapped = { id: null as string | null, name: null as string | null, note: null as string | null };
  try {
    const { schema, mapping } = await getDecodeConfig();
    decoded_event = decodeEvent(fields, schema);
    mapped = mapCampaign(fields, mapping);
  } catch (e) {
    mapped = { id: null, name: null, note: `decode error: ${(e as Error).message}` };
  }

  const row: PostbackInsert = {
    ...fields,
    raw,
    signature_status,
    decoded_event,
    mapped_campaign_id: mapped.id,
    mapped_campaign_name: mapped.name,
    decode_notes: mapped.note,
  };

  try {
    const stored = await insertPostback(row);
    return NextResponse.json({
      ok: true,
      network,
      signature_status,
      decoded_event,
      mapped_campaign_id: mapped.id,
      stored,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// Human/health probe (GET /skan and GET on the collect route). Reports config
// and, if reachable, the stored-postback count. Never exposes raw rows.
export async function collectorStatus(): Promise<Response> {
  const base = {
    ok: true,
    service: "dreamme-skan-collector",
    configured: skanStoreConfigured(),
    skan_path: "/.well-known/skadnetwork/report-attribution/",
    aak_path: "/.well-known/adattributionkit/report-attribution/",
    note: "Apple POSTs winning postback copies here; see docs/skan-diy-attribution.md",
  };
  if (!skanStoreConfigured()) {
    return NextResponse.json({ ...base, error: "collector not configured" });
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key =
      process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      "";
    const res = await fetch(
      `${url}/rest/v1/skan_postbacks?select=id&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
        cache: "no-store",
      },
    );
    const total = res.headers.get("content-range")?.split("/").pop() ?? "0";
    return NextResponse.json({ ...base, total_postbacks: Number(total) });
  } catch {
    return NextResponse.json(base);
  }
}
