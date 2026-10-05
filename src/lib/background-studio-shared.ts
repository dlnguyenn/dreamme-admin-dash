/**
 * Client-safe types/constants for Background Studio (no env, no server
 * imports). Server logic lives in `background-studio.ts`.
 */

export interface BackgroundRow {
  id: string;
  slug: string;
  name: string;
  theme: string;
  image_url: string;
  model: string | null;
  source: "generated" | "import";
  created_at: string;
}

/** Sushi with a transparent background, for the phone preview. */
export const SUSHI_CUTOUT_PATH = "/background-studio/sushi.png";

/**
 * Resized copy of a public Supabase image via Storage image transformations.
 * The 2K originals are ~3 MB, too slow for a grid (and next/image's
 * optimizer times out fetching them). Non-Supabase URLs pass through.
 */
export function resizedUrl(url: string, width: number): string {
  const marker = "/storage/v1/object/public/";
  if (!url.includes(marker)) return url;
  return `${url.replace(marker, "/storage/v1/render/image/public/")}?width=${width}&quality=75`;
}

export const BG_MODELS = {
  pro: "gemini-3-pro-image",
  flash: "gemini-3.1-flash-image-preview",
} as const;
export type BgModelKey = keyof typeof BG_MODELS;
