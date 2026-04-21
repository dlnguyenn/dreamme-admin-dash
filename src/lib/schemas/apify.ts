import { z } from "zod";

const urlString = z.string().url();

const AuthorMetaSchema = z
  .object({
    name: z.string().optional(),
  })
  .passthrough();

const VideoMetaSchema = z
  .object({
    coverUrl: urlString.optional(),
    originalCoverUrl: urlString.optional(),
  })
  .passthrough();

export const ApifyTikTokItemSchema = z
  .object({
    id: z.string().optional(),
    webVideoUrl: urlString.optional(),
    text: z.string().optional(),
    createTimeISO: z.string().optional(),
    playCount: z.number().optional(),
    diggCount: z.number().optional(),
    commentCount: z.number().optional(),
    shareCount: z.number().optional(),
    isSlideshow: z.boolean().optional(),
    slideshowImageLinks: z.array(urlString).optional(),
    authorMeta: AuthorMetaSchema.optional(),
    videoMeta: VideoMetaSchema.optional(),
  })
  .passthrough();

export type ApifyTikTokItem = z.infer<typeof ApifyTikTokItemSchema>;

export interface ParseResult {
  items: ApifyTikTokItem[];
  failed: number;
}

export function parseApifyItems(raw: unknown): ParseResult {
  if (!Array.isArray(raw)) {
    console.error("[apify] response is not an array:", typeof raw);
    return { items: [], failed: 0 };
  }
  const items: ApifyTikTokItem[] = [];
  let failed = 0;
  for (const record of raw) {
    const parsed = ApifyTikTokItemSchema.safeParse(record);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      failed++;
      const idHint =
        (record as { id?: unknown })?.id ??
        (record as { webVideoUrl?: unknown })?.webVideoUrl ??
        "(no id)";
      console.error(
        `[apify] item drift on ${idHint}:`,
        parsed.error.issues.slice(0, 3),
      );
    }
  }
  return { items, failed };
}
