import type {
  Delivery,
  DeliveryRow,
  FeatureRequest,
  FeatureRequestRow,
  Resource,
  ResourceKind,
  ResourceRow,
  SavedCaption,
  SavedCaptionRow,
  SpendLineItem,
  SpendLineItemRow,
} from "./types";
import type { PersonaId } from "./personas";
import type { BeforeScenario } from "./prompts/beforePhoto";

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
    isBefore: !!row.is_before,
    createdAt: row.created_at,
  };
}

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("reader returned non-string"));
        return;
      }
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({ base64, mime: file.type || "image/png" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("reader returned non-string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to <img> fallback below.
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error(`image decode failed: ${String(e)}`));
    };
    img.src = url;
  });
}

/**
 * Downscale an image File to a reasonable max dimension and re-encode as JPEG.
 * Keeps the upload payload well under Vercel's 4.5 MB serverless function limit
 * (phone photos are typically 3-8 MB — after this step they land around
 * 300-600 KB). Preserves orientation via imageOrientation: "from-image".
 *
 * Skips the canvas round-trip for small files (<= 500 KB) that are already
 * JPEG/WebP — those can ship as-is without re-encoding.
 */
async function downscaleImageToBase64(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {},
): Promise<{ base64: string; mime: string }> {
  const maxDim = opts.maxDimension ?? 1536;
  const quality = opts.quality ?? 0.9;

  const alreadySmall =
    file.size <= 500_000 &&
    (file.type === "image/jpeg" || file.type === "image/webp");
  if (alreadySmall) {
    return fileToBase64(file);
  }

  if (typeof document === "undefined") {
    // Not in a browser (shouldn't happen for these call sites, but be safe).
    return fileToBase64(file);
  }

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadImageBitmap(file);
  } catch {
    // Decoder failed — fall back to raw base64 and let server/infra reject
    // if it's oversized. Better than blocking the upload entirely.
    return fileToBase64(file);
  }

  const srcW =
    bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
  const srcH =
    bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  if (!srcW || !srcH) {
    return fileToBase64(file);
  }

  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fileToBase64(file);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, dstW, dstH);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return fileToBase64(file);

  const base64 = await blobToBase64(blob);
  return { base64, mime: "image/jpeg" };
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
    platform: row.platform === "instagram" ? "instagram" : "tiktok",
    createdAt: row.created_at,
  };
}

function mapResource(row: ResourceRow): Resource {
  const kind: ResourceKind = row.kind === "link" ? "link" : "image";
  return {
    id: row.id,
    kind,
    title: row.title,
    description: row.description ?? "",
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    tags: Array.isArray(row.tags) ? row.tags : [],
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  async deleteDeliveries(ids: string[]) {
    if (ids.length === 0) return;
    const list = ids.map((x) => encodeURIComponent(x)).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/deliveries?id=in.(${list})`,
      { method: "DELETE", headers: HEADERS() },
    );
    if (!res.ok) {
      throw new Error(`Supabase deliveries bulk delete failed: ${res.status}`);
    }
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

  async uploadBeforePhoto({
    personaId,
    file,
  }: {
    personaId: PersonaId;
    file: File;
  }): Promise<Delivery> {
    // Downscale before base64-encoding so we don't blow past Vercel's 4.5MB
    // serverless function body limit for phone photos.
    const { base64, mime } = await downscaleImageToBase64(file);
    return API.uploadBeforePhotoBase64({
      personaId,
      imageBase64: base64,
      imageMime: mime,
    });
  },

  async uploadBeforePhotoBase64({
    personaId,
    imageBase64,
    imageMime,
    caption,
  }: {
    personaId: PersonaId;
    imageBase64: string;
    imageMime?: string;
    /**
     * Optional short label shown under the delivery card (e.g. scenario
     * name like "Bedroom mirror"). Stored in the `caption` column.
     */
    caption?: string;
  }): Promise<Delivery> {
    const res = await fetch("/api/deliveries/before", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: personaId,
        image_base64: imageBase64,
        image_mime: imageMime ?? "image/png",
        caption,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; row?: DeliveryRow; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.row) {
      throw new Error(body?.error || `before upload failed: ${res.status}`);
    }
    return mapDelivery(body.row);
  },

  async listPersonaReferences(
    personaId: PersonaId,
  ): Promise<{ path: string; url: string }[]> {
    const res = await fetch(
      `/api/personas/references?persona=${encodeURIComponent(personaId)}`,
      { cache: "no-store" },
    );
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; items?: { path: string; url: string }[]; error?: string }
      | null;
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || `reference list failed: ${res.status}`);
    }
    return body.items ?? [];
  },

  async uploadPersonaReference({
    personaId,
    file,
  }: {
    personaId: PersonaId;
    file: File;
  }): Promise<{ path: string; url: string }> {
    // Downscale before base64-encoding so the JSON payload fits inside
    // Vercel's 4.5MB serverless function body limit (phone photos are often
    // 3-8MB raw, which balloons to 4-11MB when base64-wrapped).
    const { base64, mime } = await downscaleImageToBase64(file);
    const res = await fetch("/api/personas/references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: personaId,
        image_base64: base64,
        image_mime: mime,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; path?: string; url?: string; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.path || !body.url) {
      if (res.status === 413) {
        throw new Error(
          "Image is too large even after downscaling. Try a smaller photo.",
        );
      }
      throw new Error(body?.error || `reference upload failed: ${res.status}`);
    }
    return { path: body.path, url: body.url };
  },

  async deletePersonaReference(path: string): Promise<void> {
    const res = await fetch("/api/personas/references", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; error?: string }
      | null;
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || `reference delete failed: ${res.status}`);
    }
  },

  async generateBeforePhotos({
    personaId,
    referenceImageUrl,
    count = 2,
  }: {
    personaId: PersonaId;
    referenceImageUrl: string;
    count?: number;
  }): Promise<{
    images: {
      imageBase64: string;
      mimeType: string;
      targetLb: number;
      scenario: BeforeScenario;
    }[];
    partialErrors?: string[];
  }> {
    const res = await fetch("/api/generate/before-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: personaId,
        referenceImageUrl,
        count,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | {
          ok: boolean;
          images?: {
            imageBase64: string;
            mimeType: string;
            targetLb: number;
            scenario: BeforeScenario;
          }[];
          partialErrors?: string[];
          error?: string;
        }
      | null;
    if (!res.ok || !body?.ok || !body.images) {
      throw new Error(body?.error || `generate failed: ${res.status}`);
    }
    return { images: body.images, partialErrors: body.partialErrors };
  },

  async generateInstagramCaption({
    personaId,
    hookText,
    model,
    notes,
  }: {
    personaId: PersonaId;
    hookText: string;
    model: string;
    notes?: string;
  }): Promise<{ caption: string; charCount: number; compressAttempts: number }> {
    const res = await fetch("/api/generate/caption/instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId, hookText, model, notes }),
    });
    const body = (await res.json().catch(() => null)) as
      | {
          ok: boolean;
          caption?: string;
          charCount?: number;
          compressAttempts?: number;
          error?: string;
        }
      | null;
    if (!res.ok || !body?.ok || typeof body.caption !== "string") {
      throw new Error(body?.error || `IG caption generate failed: ${res.status}`);
    }
    return {
      caption: body.caption,
      charCount: body.charCount ?? body.caption.length,
      compressAttempts: body.compressAttempts ?? 0,
    };
  },

  /**
   * Save a generated caption to the library. Supports both TikTok (hook
   * required, default) and Instagram (either hook or delivery source).
   */
  async saveGeneratedCaption({
    personaId,
    caption,
    model,
    platform = "tiktok",
    hookId,
    deliveryId,
    notes,
    tipPoolAware = false,
  }: {
    personaId: PersonaId;
    caption: string;
    model: string;
    platform?: "tiktok" | "instagram";
    hookId?: string | null;
    deliveryId?: string | null;
    notes?: string;
    tipPoolAware?: boolean;
  }): Promise<SavedCaption> {
    const res = await fetch("/api/generate/caption/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaId,
        caption,
        model,
        platform,
        hookId: hookId ?? null,
        deliveryId: deliveryId ?? null,
        notes,
        tipPoolAware,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; savedCaption?: SavedCaptionRow; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.savedCaption) {
      throw new Error(body?.error || `caption save failed: ${res.status}`);
    }
    return mapCaption(body.savedCaption);
  },

  async fetchHookText(hookId: string): Promise<string | null> {
    if (!SUPABASE_URL || !SUPABASE_ANON) return null;
    const rows = await sbSelect<{ hook_text: string }>(
      "generated_hooks",
      `select=hook_text&id=eq.${encodeURIComponent(hookId)}&limit=1`,
    );
    return rows.length ? rows[0].hook_text : null;
  },

  async fetchResources(): Promise<Resource[]> {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      throw new Error(
        "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    const rows = await sbSelect<ResourceRow>(
      "resources",
      "select=*&order=sort_order.desc,created_at.desc",
    );
    return rows.map(mapResource);
  },

  async createResourceLink({
    title,
    description,
    linkUrl,
    tags,
  }: {
    title: string;
    description?: string;
    linkUrl: string;
    tags?: string[];
  }): Promise<Resource> {
    const res = await fetch("/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "link" as ResourceKind,
        title,
        description: description ?? null,
        linkUrl,
        tags: tags ?? [],
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; resource?: ResourceRow; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.resource) {
      throw new Error(body?.error || `resource create failed: ${res.status}`);
    }
    return mapResource(body.resource);
  },

  async createResourceImage({
    title,
    description,
    file,
    tags,
  }: {
    title: string;
    description?: string;
    file: File;
    tags?: string[];
  }): Promise<Resource> {
    const { base64, mime } = await downscaleImageToBase64(file);
    const res = await fetch("/api/resources/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description ?? null,
        image_base64: base64,
        image_mime: mime,
        tags: tags ?? [],
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; resource?: ResourceRow; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.resource) {
      if (res.status === 413) {
        throw new Error(
          "Image is too large even after downscaling. Try a smaller photo.",
        );
      }
      throw new Error(body?.error || `resource upload failed: ${res.status}`);
    }
    return mapResource(body.resource);
  },

  async updateResource(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      tags?: string[];
      linkUrl?: string;
    },
  ): Promise<Resource> {
    const res = await fetch(`/api/resources/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; resource?: ResourceRow; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.resource) {
      throw new Error(body?.error || `resource update failed: ${res.status}`);
    }
    return mapResource(body.resource);
  },

  async deleteResource(id: string): Promise<void> {
    const res = await fetch(`/api/resources/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; error?: string }
      | null;
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || `resource delete failed: ${res.status}`);
    }
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
