/**
 * PostgREST paging, shared by the consumer and internal projects.
 *
 * PostgREST silently truncates a response at its row ceiling — no error, just
 * fewer rows than asked for. For any window big enough to hit it, that is the
 * worst kind of bug: the attribution baseline would quietly lose its oldest
 * days and every share would be wrong while looking perfectly plausible.
 *
 * Counting first lets the pages be requested concurrently rather than
 * discovering the end one serial round trip at a time (the 38-day windows here
 * run to ~11,000 rows). When the count is unavailable the walk falls back to
 * sequential paging, which is slower but still correct.
 */

/** PostgREST's default ceiling; a page shorter than this means we're done. */
export const PAGE_SIZE = 1000;
/** Bound the walk — a bad window must not be able to page forever. */
export const MAX_PAGES = 20;

export async function fetchAllPages<T>(opts: {
  /** Exact row count, or null when it can't be determined. */
  count: () => Promise<number | null>;
  /** One page, starting at `offset`, at most PAGE_SIZE rows. */
  page: (offset: number) => Promise<T[]>;
  maxPages?: number;
}): Promise<T[]> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const total = await opts.count().catch(() => null);

  if (total != null) {
    const pages = Math.min(Math.ceil(total / PAGE_SIZE), maxPages);
    if (pages === 0) return [];
    const batches = await Promise.all(
      Array.from({ length: pages }, (_, i) => opts.page(i * PAGE_SIZE)),
    );
    return batches.flat();
  }

  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const rows = await opts.page(i * PAGE_SIZE);
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Total from a PostgREST `Content-Range` header ("0-999/8978"), or null. */
export function countFromContentRange(header: string | null): number | null {
  const total = Number(header?.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}
