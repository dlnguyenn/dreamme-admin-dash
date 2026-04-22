import type {
  Delivery,
  DeliveryRow,
  FeatureRequest,
  FeatureRequestRow,
  SavedCaption,
  SavedCaptionRow,
  SpendLineItem,
  SpendLineItemRow,
} from "./types";
import type { PersonaId } from "./personas";

function normalizePersonaId(raw: string): PersonaId {
  return ((raw || "").trim().toLowerCase()) as PersonaId;
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SUPABASE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

const HEADERS = () => ({
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  "Content-Type": "application/json",
});

async function sbSelect<T>(table: string, query = ""): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(url, { headers: HEADERS(), cache: "no-store" });
  if (!res.ok) throw new Error(`Supabase ${table} read failed: ${res.status}`);
  return res.json();
}

async function sbInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...HEADERS(), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `Supabase ${table} insert failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbUpdate<T>(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...HEADERS(), Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase ${table} update failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbDelete(table: string, id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: HEADERS(),
  });
  if (!res.ok) throw new Error(`Supabase ${table} delete failed: ${res.status}`);
}

function mapDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    personaId: normalizePersonaId(row.persona),
    imageUrl: row.image_url,
    caption: row.caption,
    posted: !!row.posted,
    starred: !!row.starred,
    inLibrary: !!row.in_library,
    createdAt: row.created_at,
  };
}

function mapSpend(row: SpendLineItemRow): SpendLineItem {
  return {
    id: row.id,
    vendor: row.vendor,
    category: row.category,
    amountUsd: Number(row.amount_usd) || 0,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    source: row.source,
    metadata: row.metadata,
    note: row.note,
    createdAt: row.created_at,
  };
}

function mapFeatureRequest(row: FeatureRequestRow): FeatureRequest {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    epic: row.epic,
    submitterEmail: row.submitter_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCaption(row: SavedCaptionRow): SavedCaption {
  return {
    id: row.id,
    sourceItemId: row.source_delivery_id,
    sourceHookId: row.source_hook_id,
    personaId: normalizePersonaId(row.persona),
    caption: row.caption,
    posted: !!row.posted,
    starred: !!row.starred,
    createdAt: row.created_at,
  };
}

export type DeliveryPatch = Partial<
  Pick<Delivery, "posted" | "starred" | "caption" | "inLibrary" | "imageUrl">
>;

export type CaptionPatch = Partial<
  Pick<SavedCaption, "posted" | "starred" | "caption">
>;

export const API = {
  async fetchAll() {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error(
        "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    const [deliveries, captions] = await Promise.all([
      sbSelect<DeliveryRow>("deliveries", "select=*&order=created_at.desc"),
      sbSelect<SavedCaptionRow>("saved_captions", "select=*&order=created_at.desc"),
    ]);
    return {
      items: deliveries.map(mapDelivery),
      savedCaptions: captions.map(mapCaption),
    };
  },

  async updateDelivery(id: string, patch: DeliveryPatch): Promise<Delivery> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.posted !== undefined) dbPatch.posted = patch.posted;
    if (patch.starred !== undefined) dbPatch.starred = patch.starred;
    if (patch.caption !== undefined) dbPatch.caption = patch.caption;
    if (patch.inLibrary !== undefined) dbPatch.in_library = patch.inLibrary;
    if (patch.imageUrl !== undefined) dbPatch.image_url = patch.imageUrl;
    const row = await sbUpdate<DeliveryRow>("deliveries", id, dbPatch);
    return mapDelivery(row);
  },

  async saveCaption(item: Delivery): Promise<SavedCaption> {
    const row = await sbInsert<SavedCaptionRow>("saved_captions", {
      source_delivery_id: item.id,
      persona: item.personaId,
      caption: item.caption,
    });
    await sbUpdate<DeliveryRow>("deliveries", item.id, { in_library: true });
    return mapCaption(row);
  },

  async updateCaption(id: string, patch: CaptionPatch): Promise<SavedCaption> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.posted !== undefined) dbPatch.posted = patch.posted;
    if (patch.starred !== undefined) dbPatch.starred = patch.starred;
    if (patch.caption !== undefined) dbPatch.caption = patch.caption;
    const row = await sbUpdate<SavedCaptionRow>("saved_captions", id, dbPatch);
    return mapCaption(row);
  },

  async deleteCaption(id: string) {
    await sbDelete("saved_captions", id);
  },

  async deleteDelivery(id: string) {
    await sbDelete("deliveries", id);
  },

  async fetchSpendLineItems(): Promise<SpendLineItem[]> {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error(
        "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    const rows = await sbSelect<SpendLineItemRow>(
      "spend_line_items",
      "select=*&order=period_start.desc",
    );
    return rows.map(mapSpend);
  },

  async fetchFeatureRequests(): Promise<FeatureRequest[]> {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error(
        "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    const rows = await sbSelect<FeatureRequestRow>(
      "feature_requests",
      "select=*&order=created_at.desc",
    );
    return rows.map(mapFeatureRequest);
  },

  async fetchDelivery(id: string): Promise<Delivery | null> {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error(
        "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    const rows = await sbSelect<DeliveryRow>(
      "deliveries",
      `select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    return rows.length ? mapDelivery(rows[0]) : null;
  },
};
