/**
 * n8n REST API client (bare fetch, no SDK).
 *
 * Counts executions of a given workflow within a time window. n8n returns
 * executions newest-first; we paginate via `nextCursor` and stop once we
 * cross the lower bound.
 */
// Read env lazily inside functions — top-level constants capture process.env
// before loadEnvConfig runs in CLI scripts (ESM imports hoist).
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Accept either name — N8N_API_KEY for new callers, N8N_CLAUDE_ACCESS_KEY for
// the existing key already present in this repo's .env.local.
function getApiKey(): string {
  return process.env.N8N_API_KEY ?? process.env.N8N_CLAUDE_ACCESS_KEY ?? "";
}
function getBaseUrl(): string {
  return (process.env.N8N_BASE_URL ?? "https://n8n.dreammeops.us").replace(
    /\/+$/,
    "",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function n8nConfigured(): boolean {
  return !!getApiKey();
}

interface ExecutionRow {
  id: number | string;
  finished?: boolean;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
  workflowId?: string;
}

interface ExecutionListResponse {
  data?: ExecutionRow[];
  nextCursor?: string | null;
}

export async function fetchExecutionCount(params: {
  workflowId: string;
  since: Date; // inclusive lower bound
  until: Date; // exclusive upper bound
  status?: "success" | "error" | "waiting";
  maxRetries?: number;
}): Promise<number> {
  const API_KEY = getApiKey();
  const BASE_URL = getBaseUrl();
  if (!API_KEY) throw new Error("N8N_API_KEY not set");
  const maxRetries = params.maxRetries ?? 4;
  const status = params.status ?? "success";

  let count = 0;
  let cursor: string | null = null;

  while (true) {
    const qs = new URLSearchParams({
      workflowId: params.workflowId,
      status,
      limit: "250",
    });
    if (cursor) qs.set("cursor", cursor);

    const url = `${BASE_URL}/api/v1/executions?${qs.toString()}`;

    let attempt = 0;
    let body: ExecutionListResponse | null = null;
    while (true) {
      const res = await fetch(url, {
        headers: { "X-N8N-API-KEY": API_KEY, accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        body = (await res.json()) as ExecutionListResponse;
        break;
      }
      const text = await res.text();
      if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
        throw new Error(`n8n executions error: ${res.status} ${text}`);
      }
      const retryAfter = res.headers.get("retry-after");
      const retryMs = retryAfter
        ? Math.max(0, Math.min(60_000, Number(retryAfter) * 1000))
        : 0;
      const backoff = Math.min(32_000, 1000 * Math.pow(2, attempt));
      await sleep(retryMs || backoff + Math.floor(Math.random() * 250));
      attempt++;
    }

    let stoppedEarly = false;
    for (const exec of body?.data ?? []) {
      const startedAt = exec.startedAt ? new Date(exec.startedAt) : null;
      if (!startedAt || Number.isNaN(startedAt.getTime())) continue;
      if (startedAt < params.since) {
        stoppedEarly = true;
        break;
      }
      if (startedAt >= params.until) continue;
      // Defensive client-side filter — some n8n versions ignore the server-side
      // status query param. Re-check here.
      if (status === "success") {
        if (exec.status && exec.status !== "success") continue;
        if (exec.status === undefined && exec.finished === false) continue;
      }
      count++;
    }

    if (stoppedEarly) break;
    if (!body?.nextCursor) break;
    cursor = body.nextCursor;
  }

  return count;
}
