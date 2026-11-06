import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActiveSubscribers } from "@/lib/audience-subscribers";
import { iterateCustomers } from "@/lib/vendors/revenuecat";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5);
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString();

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("iterateCustomers", () => {
  beforeEach(() => {
    vi.stubEnv("REVENUECAT_API_KEY", "key");
    vi.stubEnv("REVENUECAT_PROJECT_ID", "proj");
  });

  it("keeps walking past a customer older than the window", async () => {
    // RevenueCat returns customers in no date order. The walk used to end at
    // the first old one, which on 2026-11-05 was the 13th customer returned,
    // so the weekly audience sync saw 12 customers out of tens of thousands.
    const customer = (id: string, daysAgo: number) => ({
      id,
      first_seen_at: NOW - daysAgo * DAY,
      last_seen_at: NOW,
    });
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("starting_after")
        ? json({ items: [customer("old-2", 250), customer("new-3", 90)], next_page: null })
        : json({
            items: [customer("new-1", 5), customer("old-1", 400), customer("new-2", 30)],
            next_page: "https://api.revenuecat.com/v2/projects/proj/customers?starting_after=new-2&limit=100",
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const seen: string[] = [];
    for await (const c of iterateCustomers({ sinceMs: NOW - 180 * DAY })) seen.push(c.id);

    expect(seen).toEqual(["new-1", "new-2", "new-3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchActiveSubscribers", () => {
  beforeEach(() => {
    vi.stubEnv("CONSUMER_SUPABASE_URL", "https://consumer.test");
    vi.stubEnv("CONSUMER_SERVICE_ROLE_KEY", "service-key");
  });

  const subscriptions = [
    // Subscribed over a year ago: the old 180-day first-seen window dropped these.
    { user_id: "u-old", product_id: "yearly", purchased_at: iso(-35), original_purchased_at: iso(-400), expires_at: iso(330) },
    // Two live rows after a plan change collapse into one holding.
    { user_id: "u-switch", product_id: "monthly", purchased_at: iso(-10), original_purchased_at: iso(-100), expires_at: iso(2) },
    { user_id: "u-switch", product_id: "yearly", purchased_at: iso(-1), original_purchased_at: null, expires_at: iso(364) },
    { user_id: "u-relay", product_id: "monthly", purchased_at: iso(-3), original_purchased_at: iso(-3), expires_at: iso(27) },
    { user_id: "u-nomail", product_id: "monthly", purchased_at: iso(-3), original_purchased_at: iso(-3), expires_at: iso(27) },
    { user_id: null, product_id: "monthly", purchased_at: iso(-3), original_purchased_at: iso(-3), expires_at: iso(27) },
  ];
  const users = [
    { id: "u-old", email: " Old@Example.com " },
    { id: "u-switch", email: "switch@example.com" },
    { id: "u-relay", email: "abc123@privaterelay.appleid.com" },
    { id: "u-nomail", email: null },
  ];

  function stubConsumerDb() {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (init?.method === "HEAD") {
          return new Response(null, { status: 206, headers: { "content-range": `0-0/${subscriptions.length}` } });
        }
        return json(url.includes("/rest/v1/users?") ? users : subscriptions);
      }),
    );
    return urls;
  }

  it("returns every live subscriber with a matchable email, whatever their age", async () => {
    stubConsumerDb();

    const scan = await fetchActiveSubscribers({ nowMs: NOW });

    expect(scan.totalActive).toBe(5);
    expect(scan.skipped).toEqual({ noAccount: 1, noEmail: 1, relay: 1 });
    expect(scan.subscribers).toEqual([
      { customerId: "u-old", email: "old@example.com", productId: "yearly", startsAtMs: NOW - 400 * DAY, expiresAtMs: NOW + 330 * DAY },
      { customerId: "u-switch", email: "switch@example.com", productId: "yearly", startsAtMs: NOW - 100 * DAY, expiresAtMs: NOW + 364 * DAY },
    ]);
  });

  it("asks only for live production subscriptions", async () => {
    const urls = stubConsumerDb();

    await fetchActiveSubscribers({ nowMs: NOW });

    const read = urls.find((u) => u.includes("/rest/v1/subscriptions?select=user_id"));
    expect(read).toContain("environment=eq.production");
    expect(read).toContain("is_active=is.true");
    expect(read).toContain(`expires_at=gt.${encodeURIComponent(new Date(NOW).toISOString())}`);
  });
});
