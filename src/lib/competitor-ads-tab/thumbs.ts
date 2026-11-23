/**
 * Small card thumbnails for competitor ad frames.
 *
 * Outlier stores each ad's frame at full size (1080x1920) in our bucket under
 * competitor-ads/{page}/{ad}.jpg. Supabase's render/image resize answers
 * `no-cache`, so every visit re-resized every card (about 1 s each, cold).
 * Instead the DAD keeps one 480-wide copy per ad at a fixed path, cached for
 * a year; the card asks for it to be made the first time it is missing.
 */

export const THUMB_WIDTH = 480;
const OBJECT = "/storage/v1/object/public/";
const FRAME = /^(https:\/\/[^/]+)\/storage\/v1\/object\/public\/([^/]+)\/competitor-ads\/(\d+)\/(\d+)\.(jpe?g|png|webp)$/i;

/** competitor-ads/{page}/{ad}.jpg -> its thumbnail's bucket path, or null for any other URL. */
export function thumbPath(frameUrl: string): { origin: string; bucket: string; path: string } | null {
  const m = FRAME.exec(frameUrl);
  if (!m) return null;
  return { origin: m[1], bucket: m[2], path: `competitor-ads/thumbs/w${THUMB_WIDTH}/${m[3]}/${m[4]}.jpg` };
}

/** The stored small copy's public URL (it may not exist yet). */
export function smallThumbUrl(frameUrl: string): string | null {
  const t = thumbPath(frameUrl);
  return t ? `${t.origin}${OBJECT}${t.bucket}/${t.path}` : null;
}

/** Supabase's on-the-fly resize: the slow path, used to make the copy and as the fallback. */
export function renderUrl(frameUrl: string, width = THUMB_WIDTH): string {
  if (!frameUrl.includes(OBJECT)) return frameUrl;
  return `${frameUrl.replace(OBJECT, "/storage/v1/render/image/public/")}?width=${width}&height=${width * 2}&resize=contain&quality=72`;
}
