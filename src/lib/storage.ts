import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const PERSONA_BUCKET = "persona-images";

/** Generate a time-limited signed URL for an image in the private bucket. */
export async function signedImageUrl(
  path: string,
  expiresInSeconds = 60 * 60,
): Promise<string | null> {
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.storage
    .from(PERSONA_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function signedImageUrls(
  paths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.storage
    .from(PERSONA_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
}
