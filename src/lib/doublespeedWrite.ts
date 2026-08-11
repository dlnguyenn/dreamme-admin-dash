/**
 * The write half of the Doublespeed client.
 *
 * `PATCH /api/v1/posts/{id}/status` moves a post between draft and scheduled,
 * authenticated with the same `ds-` key the read paths use. Note the route is
 * the `/status` SUB-path: `PATCH /api/v1/posts/{id}` is a 405 and does not
 * exist, which is what previously led to the wrong conclusion that this API
 * could not write at all.
 *
 * Per the vendor docs the call is idempotent — scheduling an already-scheduled
 * post returns ok without changing anything — so retries and double-clicks are
 * safe. Only a draft can be scheduled and only a scheduled post can be
 * drafted; anything else comes back 400 with a readable reason.
 */
const BASE = (
  process.env.DOUBLESPEED_API_BASE ?? "https://app.doublespeed.ai"
).replace(/\/+$/, "");
const KEY = process.env.DOUBLESPEED_API_KEY ?? "";

export function doublespeedWriteConfigured(): boolean {
  return KEY !== "";
}

export interface SetStatusResult {
  ok: boolean;
  /** The reserved slot, when the account has auto-scheduling; null otherwise. */
  scheduledAt?: string | null;
  error?: string;
}

export async function setPostStatus(
  postId: string,
  status: "scheduled" | "draft",
): Promise<SetStatusResult> {
  if (!doublespeedWriteConfigured()) {
    return { ok: false, error: "DOUBLESPEED_API_KEY not configured" };
  }
  try {
    const res = await fetch(
      `${BASE}/api/v1/posts/${encodeURIComponent(postId)}/status`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ status }),
        cache: "no-store",
      },
    );

    // Vendor errors can be HTML, so read defensively and cap the body. Never
    // include the key in anything that surfaces to a caller or a log.
    const text = await res.text();
    let body: { ok?: boolean; error?: string; scheduled_at?: string | null } = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body falls through to the status-code message below */
    }

    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        error: body.error ?? `Doublespeed ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    return { ok: true, scheduledAt: body.scheduled_at ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
