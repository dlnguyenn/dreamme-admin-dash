import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAudienceSync } from "@/lib/audiences";
import { fetchActiveSubscribers } from "@/lib/audience-subscribers";
import { fetchOverview } from "@/lib/vendors/revenuecat";

vi.mock("@/lib/meta-oauth", () => ({
  resolveMetaToken: vi.fn(async () => ({ token: "meta-token", account: "act_1" })),
}));
vi.mock("@/lib/audience-subscribers", () => ({ fetchActiveSubscribers: vi.fn() }));
vi.mock("@/lib/vendors/revenuecat", () => ({ fetchOverview: vi.fn() }));

const overview = (subs: number, trials: number) => ({
  active_trials: trials,
  active_subscriptions: subs,
  mrr: 0,
  revenue: 0,
  new_customers: 0,
  active_users: 0,
});
const skipped = { noAccount: 0, noEmail: 0, relay: 0 };

describe("runAudienceSync", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://internal.test");
    vi.stubEnv("DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY", "service-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("writes nothing when the subscriber read is far short of RevenueCat's count", async () => {
    // What production did for four months: 12 customers enumerated against
    // ~5,000 active. Carrying on would flip every missed subscriber to lapsed,
    // pull them out of suppression and put them in win-back.
    vi.mocked(fetchActiveSubscribers).mockResolvedValue({ totalActive: 12, subscribers: [], skipped });
    vi.mocked(fetchOverview).mockResolvedValue(overview(4520, 505));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runAudienceSync({ dryRun: false })).rejects.toThrow(
      "found 12, RevenueCat reports 5025 active",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("snapshots a healthy read with hashed emails and first-purchase tenure", async () => {
    const startsAtMs = Date.UTC(2026, 0, 15);
    vi.mocked(fetchActiveSubscribers).mockResolvedValue({
      totalActive: 5019,
      subscribers: [
        { customerId: "u-1", email: "one@example.com", productId: "yearly", startsAtMs, expiresAtMs: Date.UTC(2027, 0, 15) },
      ],
      skipped: { noAccount: 19, noEmail: 58, relay: 2106 },
    });
    vi.mocked(fetchOverview).mockResolvedValue(overview(4520, 505));
    const writes: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("graph.facebook.com")) return new Response('{"data":[]}', { status: 200 });
        if (init?.method === "POST" || init?.method === "PATCH") {
          writes.push({ url, body: String(init.body) });
          return new Response(null, { status: 204 });
        }
        return new Response("[]", { status: 200 });
      }),
    );

    const result = await runAudienceSync({ dryRun: false });

    expect(result.enumeration).toEqual({
      totalActive: 5019,
      revenueCatActive: 5025,
      matchable: 1,
      skipped: { noAccount: 19, noEmail: 58, relay: 2106 },
    });
    const upsert = writes.find((w) => w.url.includes("/rc_customer_snapshot?on_conflict=customer_id"));
    const [row] = JSON.parse(upsert!.body);
    expect(row).toMatchObject({
      customer_id: "u-1",
      entitlement: "yearly",
      status: "active",
      // Tenure was always null from RevenueCat, so the high-LTV seed never filled.
      starts_at: new Date(startsAtMs).toISOString(),
    });
    expect(row.email_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(upsert!.body).not.toContain("one@example.com");
  });

  it("a dry run writes nothing and still reports what a live run would do", async () => {
    // A dry run used to upsert the snapshot and flip lapsed rows. The next live
    // run then saw no one as newly lapsed and left them in Meta's suppression
    // audience. Three subscribers were swallowed that way on 2026-11-06.
    const DAY = 86_400_000;
    const sub = (customerId: string, daysHeld: number) => ({
      customerId,
      email: `${customerId}@example.com`,
      productId: "yearly",
      startsAtMs: Date.now() - daysHeld * DAY,
      expiresAtMs: Date.now() + 30 * DAY,
    });
    vi.mocked(fetchActiveSubscribers).mockResolvedValue({
      totalActive: 5019,
      // stays subscribed (long tenure), re-subscribed after lapsing, brand new
      subscribers: [sub("stays", 200), sub("returns", 5), sub("new", 1)],
      skipped,
    });
    vi.mocked(fetchOverview).mockResolvedValue(overview(4520, 505));
    const existing = [
      { customer_id: "stays", email_sha256: "h-stays", status: "active" },
      { customer_id: "leaves", email_sha256: "h-leaves", status: "active" },
      { customer_id: "returns", email_sha256: "h-returns", status: "lapsed" },
      { customer_id: "long-gone", email_sha256: "h-long-gone", status: "lapsed" },
    ];
    const writes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method && init.method !== "HEAD") writes.push(`${init.method} ${url}`);
        if (url.includes("graph.facebook.com")) return new Response('{"data":[]}', { status: 200 });
        if (init?.method === "HEAD") return new Response(null, { status: 204 });
        const snapshot = url.includes("/rc_customer_snapshot?select=customer_id,email_sha256,status");
        return new Response(JSON.stringify(snapshot ? existing : []), { status: 200 });
      }),
    );

    const result = await runAudienceSync({ dryRun: true });

    expect(writes).toEqual([]);
    expect(result.snapshot).toEqual({ activeUpserted: 3, lapsedFlipped: 1 });
    expect(result.cohorts).toEqual({ active: 3, highLtv: 1, lapsed: 2, becameLapsedThisRun: 1 });
    expect(result.audiences.find((a) => a.purpose === "suppression_active")).toMatchObject({
      added: 3,
      removed: 1,
    });
  });

  it("reads a cohort past PostgREST's 1,000-row ceiling", async () => {
    // The first deployed run of the fixed sync snapshotted 2,839 subscribers
    // and then reported a suppression audience of exactly 1,000: one request
    // with a large limit comes back cut to 1,000 rows, with no error.
    const TOTAL = 2500;
    vi.mocked(fetchActiveSubscribers).mockResolvedValue({ totalActive: 5019, subscribers: [], skipped });
    vi.mocked(fetchOverview).mockResolvedValue(overview(4520, 505));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("graph.facebook.com")) return new Response('{"data":[]}', { status: 200 });
        const allActive =
          url.includes("/rc_customer_snapshot?status=eq.active&email_sha256") && !init?.body;
        if (!allActive) return new Response(init?.method ? null : "[]", { status: init?.method ? 204 : 200 });
        if (init?.method === "HEAD") {
          return new Response(null, { status: 206, headers: { "content-range": `0-0/${TOTAL}` } });
        }
        const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
        const rows = Array.from({ length: Math.min(1000, TOTAL - offset) }, (_, i) => ({
          email_sha256: `hash-${offset + i}`,
        }));
        return new Response(JSON.stringify(rows), { status: 200 });
      }),
    );

    const result = await runAudienceSync({ dryRun: false });

    expect(result.cohorts.active).toBe(TOTAL);
    expect(result.audiences.find((a) => a.purpose === "suppression_active")?.memberCount).toBe(TOTAL);
  });
});
