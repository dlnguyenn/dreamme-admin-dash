/**
 * Support Inbox — client-side API helpers (same-origin; the routes accept
 * same-origin calls behind the password gate).
 */
import type {
  SupportDraftRow,
  SupportThreadRow,
  ThreadDetailPayload,
  ThreadStatus,
} from "@/lib/support/types";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string })
    | null;
  if (!res.ok || !body || body.ok === false) {
    throw new Error(body?.error || `request failed: ${res.status}`);
  }
  return body;
}

export async function fetchThreads(
  status?: ThreadStatus | "open",
  q?: string,
): Promise<{
  threads: SupportThreadRow[];
  unreadCount: number;
}> {
  const params = new URLSearchParams();
  if (q?.trim()) {
    params.set("q", q.trim()); // search overrides the status filter
  } else if (status && status !== "open") {
    params.set("status", status);
  }
  const qs = params.toString() ? `?${params.toString()}` : "";
  return json(await fetch(`/api/support/threads${qs}`, { cache: "no-store" }));
}

export async function fetchThreadDetail(
  id: string,
): Promise<ThreadDetailPayload> {
  return json(
    await fetch(`/api/support/threads/${encodeURIComponent(id)}`, {
      cache: "no-store",
    }),
  );
}

export async function patchThread(
  id: string,
  patch: {
    status?: ThreadStatus;
    snoozed_until?: string | null;
    unread?: boolean;
  },
): Promise<{ thread: SupportThreadRow }> {
  return json(
    await fetch(`/api/support/threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function sendReply(
  id: string,
  params: {
    body: string;
    draftId?: string;
    to?: string;
    /** per-dialog key so retries/double-clicks dedupe server-side */
    idempotencyKey?: string;
  },
): Promise<{ messageId: string; to: string }> {
  return json(
    await fetch(`/api/support/threads/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),
  );
}

export async function retriage(
  id: string,
): Promise<{ thread: SupportThreadRow; drafts: SupportDraftRow[] }> {
  return json(
    await fetch(`/api/support/threads/${encodeURIComponent(id)}/retriage`, {
      method: "POST",
    }),
  );
}

export interface StripeLookupResult {
  subscription: {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: number;
    trial_end: number | null;
  };
  latestCharge: {
    paymentIntentId: string | null;
    chargeId: string | null;
    amount: number;
    currency: string;
    created: number;
    refunded: boolean;
    amountRefunded: number;
  } | null;
}

export async function runAction(
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return json(
    await fetch(`/api/support/threads/${encodeURIComponent(id)}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function pollNow(): Promise<{
  report: {
    emailsFetched: number;
    emailsInserted: number;
    feedbackFetched: number;
    feedbackInserted: number;
    threadsTriaged: number;
    triageErrors: string[];
    legErrors: string[];
  };
}> {
  return json(await fetch(`/api/support/poll`, { method: "POST" }));
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
