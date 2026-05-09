/**
 * Server-only Supabase Storage helpers. Uses the service-role key so routes
 * can upload/delete on behalf of the admin after `checkIngestAuth` has
 * gated the request.
 *
 * The references-scrape flow needs to copy TikTok CDN images into our own
 * bucket because the TikTok-hosted URLs expire. Every slide image gets
 * re-hosted under `references/{refId}/...`.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

export function storageConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

export function storageBucket(): string {
  return BUCKET;
}

/**
 * Upload raw bytes to a Supabase Storage bucket. Returns the public URL.
 * Used by `fetchToStorage` and by other callers (e.g. image generation)
 * that already hold the bytes in memory.
 */
export async function uploadBytesToStorage(
  bucket: string,
  path: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  if (!storageConfigured()) {
    throw new Error("Supabase storage not configured");
  }
  const upload = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: bytes as BodyInit,
    },
  );
  if (!upload.ok) {
    throw new Error(
      `storage upload failed: ${upload.status} ${await upload.text()}`,
    );
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Fetch a remote URL and upload the bytes to Supabase Storage under the
 * given bucket path. Returns the public URL.
 *
 * Content-type is taken from the remote response when available; falls
 * back to `image/jpeg` since slideshow images are JPEG in practice.
 */
export async function fetchToStorage(
  remoteUrl: string,
  path: string,
): Promise<string> {
  if (!/^https?:\/\//i.test(remoteUrl)) {
    throw new Error("Only http(s) URLs are supported for remote fetch");
  }

  const remote = await fetch(remoteUrl, {
    // TikTok CDN doesn't require special headers for downloadLink URLs
    // returned by Apify, but a generic UA avoids the occasional 403.
    headers: { "User-Agent": "dreamme-admin-dash/1.0" },
  });
  if (!remote.ok) {
    throw new Error(
      `remote fetch failed: ${remote.status} ${remote.statusText}`,
    );
  }
  const contentType =
    remote.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const arrayBuf = await remote.arrayBuffer();
  return uploadBytesToStorage(BUCKET, path, arrayBuf, contentType);
}

/**
 * Extract the bucket-relative path from a public Supabase Storage URL.
 * Returns null if the URL doesn't match the public-object shape for the
 * given bucket. Defaults to the admin bucket so existing callers
 * (resources, references) keep working without changes.
 */
export function extractStoragePath(
  url: string | null,
  bucket: string = BUCKET,
): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  return url.slice(i + marker.length);
}

/**
 * Best-effort delete a blob from Storage. Returns true on success, false
 * on any failure — callers swallow errors and fall back to DB cleanup.
 */
export async function storageDelete(
  path: string,
  bucket: string = BUCKET,
): Promise<boolean> {
  if (!storageConfigured()) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
