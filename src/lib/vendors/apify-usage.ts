const APIFY_KEY = process.env.APIFY_KEY ?? "";
const API = "https://api.apify.com/v2/users/me/usage/monthly";

export function apifyUsageConfigured(): boolean {
  return !!APIFY_KEY;
}

export interface ApifyCycleUsage {
  cycleStart: string;
  cycleEnd: string;
  usdTotal: number;
  dailyBreakdown: Array<{ date: string; usd: number }>;
}

interface MonthlyResponse {
  data?: {
    monthlyServiceUsage?: {
      periodStart?: string;
      periodEnd?: string;
    };
    dailyServiceUsages?: Array<{
      date?: string;
      totalUsdBilled?: number;
      totalUsdBilledCredits?: number;
    }>;
    usageCycle?: {
      startAt?: string;
      endAt?: string;
    };
    totalUsdBilled?: number;
  };
}

export async function fetchApifyCurrentCycle(): Promise<ApifyCycleUsage> {
  if (!APIFY_KEY) throw new Error("APIFY_KEY not set");

  const res = await fetch(API, {
    headers: {
      Authorization: `Bearer ${APIFY_KEY}`,
      "content-type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Apify usage error: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as MonthlyResponse;
  const d = json.data ?? {};

  const cycleStart =
    d.usageCycle?.startAt ??
    d.monthlyServiceUsage?.periodStart ??
    new Date().toISOString();
  const cycleEnd =
    d.usageCycle?.endAt ??
    d.monthlyServiceUsage?.periodEnd ??
    new Date().toISOString();

  const daily = d.dailyServiceUsages ?? [];
  const dailyBreakdown = daily
    .filter((x) => x.date)
    .map((x) => ({
      date: String(x.date).slice(0, 10),
      usd: Math.round(Number(x.totalUsdBilled ?? 0) * 100) / 100,
    }));

  const usdTotal =
    typeof d.totalUsdBilled === "number"
      ? Math.round(d.totalUsdBilled * 100) / 100
      : Math.round(
          dailyBreakdown.reduce((s, x) => s + x.usd, 0) * 100,
        ) / 100;

  return {
    cycleStart: cycleStart.slice(0, 10),
    cycleEnd: cycleEnd.slice(0, 10),
    usdTotal,
    dailyBreakdown,
  };
}
