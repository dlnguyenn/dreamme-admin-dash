const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_KEY ?? "";
const ADMIN_API = "https://api.anthropic.com/v1/organizations/usage_report/cost";
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function anthropicAdminConfigured(): boolean {
  return !!ADMIN_KEY;
}

export interface DailyCost {
  date: string;
  usd: number;
}

interface CostBucket {
  starting_at?: string;
  results?: Array<{ amount?: string | number; currency?: string }>;
}

interface CostResponse {
  data?: CostBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

export async function fetchAnthropicDailyCost(params: {
  start: Date;
  end: Date;
  maxRetries?: number;
}): Promise<DailyCost[]> {
  if (!ADMIN_KEY) throw new Error("ANTHROPIC_ADMIN_KEY not set");
  const maxRetries = params.maxRetries ?? 4;

  const qs = new URLSearchParams({
    starting_at: params.start.toISOString(),
    ending_at: params.end.toISOString(),
    bucket_width: "1d",
  });

  const out: DailyCost[] = [];
  let nextPage: string | null = null;

  while (true) {
    const url = nextPage
      ? `${ADMIN_API}?${qs.toString()}&page=${encodeURIComponent(nextPage)}`
      : `${ADMIN_API}?${qs.toString()}`;

    let attempt = 0;
    let data: CostResponse | null = null;
    while (true) {
      const res = await fetch(url, {
        headers: {
          "x-api-key": ADMIN_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        cache: "no-store",
      });
      if (res.ok) {
        data = (await res.json()) as CostResponse;
        break;
      }
      const body = await res.text();
      if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
        throw new Error(`Anthropic admin error: ${res.status} ${body}`);
      }
      const retryAfter = res.headers.get("retry-after");
      const retryMs = retryAfter
        ? Math.max(0, Math.min(30_000, Number(retryAfter) * 1000))
        : 0;
      const backoff = Math.min(16_000, 500 * Math.pow(2, attempt));
      await sleep(retryMs || backoff + Math.floor(Math.random() * 250));
      attempt++;
    }

    for (const bucket of data?.data ?? []) {
      if (!bucket.starting_at) continue;
      const date = bucket.starting_at.slice(0, 10);
      let usd = 0;
      for (const r of bucket.results ?? []) {
        const n = typeof r.amount === "string" ? Number(r.amount) : (r.amount ?? 0);
        if (Number.isFinite(n)) usd += Number(n);
      }
      out.push({ date, usd: Math.round(usd * 100) / 100 });
    }

    if (!data?.has_more || !data?.next_page) break;
    nextPage = data.next_page;
  }

  return out;
}
