/**
 * Server-side CRUD against the `avatars` table. Each avatar holds a
 * single reference image in the public `dreamme-admin-internal-images`
 * bucket under `avatars/{name}-{shortid}.{ext}`. The short-id
 * suffix changes on every replace so the public URL turns over and
 * we don't have to fight CDN caches.
 */
import { randomBytes } from "node:crypto";
import {
  extractStoragePath,
  storageDelete,
  uploadBytesToStorage,
} from "./storage";
import type { Avatar, AvatarRow } from "./types";
import { isAvatarId, type AvatarId } from "./avatars";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const ADMIN_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function authHeaders(): HeadersInit {
  const key = SERVICE_ROLE || SUPABASE_ANON;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

function mapAvatar(row: AvatarRow): Avatar {
  return {
    name: row.name as AvatarId,
    imageUrl: row.image_url,
    updatedAt: row.updated_at,
  };
}

export async function listAvatars(): Promise<Avatar[]> {
  const url = `${SUPABASE_URL}/rest/v1/avatars?select=name,image_url,updated_at&order=name.asc`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `avatars read failed: ${res.status} ${await res.text()}`,
    );
  }
  const rows = (await res.json()) as AvatarRow[];
  return rows.filter((r) => isAvatarId(r.name)).map(mapAvatar);
}

async function readOne(name: AvatarId): Promise<AvatarRow | null> {
  const url = `${SUPABASE_URL}/rest/v1/avatars?select=name,image_url,updated_at&name=eq.${encodeURIComponent(name)}&limit=1`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `avatars read failed: ${res.status} ${await res.text()}`,
    );
  }
  const rows = (await res.json()) as AvatarRow[];
  return rows[0] ?? null;
}

async function patchOne(
  name: AvatarId,
  patch: { image_url: string | null },
): Promise<AvatarRow> {
  // Upsert via PATCH after seeded rows; if a row is missing
  // (shouldn't happen, but defensive against partial migrations),
  // fall back to insert.
  const url = `${SUPABASE_URL}/rest/v1/avatars?name=eq.${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      image_url: patch.image_url,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `avatars update failed: ${res.status} ${await res.text()}`,
    );
  }
  const rows = (await res.json()) as AvatarRow[];
  if (rows.length > 0) return rows[0];

  // Row didn't exist — insert it.
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/avatars`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ name, image_url: patch.image_url }),
  });
  if (!insertRes.ok) {
    throw new Error(
      `avatars insert failed: ${insertRes.status} ${await insertRes.text()}`,
    );
  }
  const inserted = (await insertRes.json()) as AvatarRow[];
  return inserted[0];
}

export async function setAvatarImage(
  name: AvatarId,
  bytes: ArrayBuffer,
  mime: string,
): Promise<Avatar> {
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw new Error(`unsupported mime type: ${mime}`);
  }

  // Best-effort delete of the previous blob so we don't leak
  // storage on every replace. The DB always stores the latest URL,
  // so a stranded blob is just wasted bytes.
  const prev = await readOne(name);
  if (prev?.image_url) {
    const prevPath = extractStoragePath(prev.image_url, ADMIN_BUCKET);
    if (prevPath) {
      await storageDelete(prevPath, ADMIN_BUCKET);
    }
  }

  const shortId = randomBytes(4).toString("hex");
  const path = `avatars/${name}-${shortId}.${ext}`;
  const publicUrl = await uploadBytesToStorage(ADMIN_BUCKET, path, bytes, mime);

  const row = await patchOne(name, { image_url: publicUrl });
  return mapAvatar(row);
}

export async function clearAvatarImage(name: AvatarId): Promise<Avatar> {
  const prev = await readOne(name);
  if (prev?.image_url) {
    const prevPath = extractStoragePath(prev.image_url, ADMIN_BUCKET);
    if (prevPath) {
      await storageDelete(prevPath, ADMIN_BUCKET);
    }
  }
  const row = await patchOne(name, { image_url: null });
  return mapAvatar(row);
}
