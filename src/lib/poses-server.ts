/**
 * Server-side CRUD against the `pose_references` table. Each pose holds a
 * single reference image in the public `dreamme-admin-internal-images`
 * bucket under `poses/{name}-{shortid}.{ext}`. The short-id suffix changes
 * on every replace so the public URL turns over and we don't fight CDN
 * caches. Mirrors src/lib/avatars-server.ts.
 */
import { randomBytes } from "node:crypto";
import {
  extractStoragePath,
  storageDelete,
  uploadBytesToStorage,
} from "./storage";
import type { Pose, PoseRow } from "./types";
import { isPoseId, type PoseId } from "./poses";

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

function mapPose(row: PoseRow): Pose {
  return {
    name: row.name as PoseId,
    imageUrl: row.image_url,
    updatedAt: row.updated_at,
  };
}

export async function listPoses(): Promise<Pose[]> {
  const url = `${SUPABASE_URL}/rest/v1/pose_references?select=name,image_url,updated_at&order=name.asc`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`poses read failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as PoseRow[];
  return rows.filter((r) => isPoseId(r.name)).map(mapPose);
}

async function readOne(name: PoseId): Promise<PoseRow | null> {
  const url = `${SUPABASE_URL}/rest/v1/pose_references?select=name,image_url,updated_at&name=eq.${encodeURIComponent(name)}&limit=1`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`poses read failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as PoseRow[];
  return rows[0] ?? null;
}

async function patchOne(
  name: PoseId,
  patch: { image_url: string | null },
): Promise<PoseRow> {
  // Upsert via PATCH after seeded rows; fall back to insert if a row is
  // missing (defensive against partial migrations).
  const url = `${SUPABASE_URL}/rest/v1/pose_references?name=eq.${encodeURIComponent(name)}`;
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
    throw new Error(`poses update failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as PoseRow[];
  if (rows.length > 0) return rows[0];

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pose_references`, {
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
      `poses insert failed: ${insertRes.status} ${await insertRes.text()}`,
    );
  }
  const inserted = (await insertRes.json()) as PoseRow[];
  return inserted[0];
}

export async function setPoseImage(
  name: PoseId,
  bytes: ArrayBuffer,
  mime: string,
): Promise<Pose> {
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw new Error(`unsupported mime type: ${mime}`);
  }

  // Best-effort delete of the previous blob so we don't leak storage on
  // every replace.
  const prev = await readOne(name);
  if (prev?.image_url) {
    const prevPath = extractStoragePath(prev.image_url, ADMIN_BUCKET);
    if (prevPath) {
      await storageDelete(prevPath, ADMIN_BUCKET);
    }
  }

  const shortId = randomBytes(4).toString("hex");
  const path = `poses/${name}-${shortId}.${ext}`;
  const publicUrl = await uploadBytesToStorage(ADMIN_BUCKET, path, bytes, mime);

  const row = await patchOne(name, { image_url: publicUrl });
  return mapPose(row);
}

export async function clearPoseImage(name: PoseId): Promise<Pose> {
  const prev = await readOne(name);
  if (prev?.image_url) {
    const prevPath = extractStoragePath(prev.image_url, ADMIN_BUCKET);
    if (prevPath) {
      await storageDelete(prevPath, ADMIN_BUCKET);
    }
  }
  const row = await patchOne(name, { image_url: null });
  return mapPose(row);
}
