import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://internal.test",
  DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY: "svc",
  CONSUMER_SUPABASE_URL: "https://consumer.test",
  CONSUMER_SERVICE_ROLE_KEY: "csvc",
};
const saved: Record<string, string | undefined> = {};
const uuid = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;

beforeEach(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("syncUserSources", () => {
  it("walks consumer users by id and upserts each page into user_sources", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: uuid(i),
      referral_source: i % 2 ? "tiktok" : null,
      onboarding_completed_at: null,
    }));
    const page2 = [{ id: uuid(5000), referral_source: "facebook", onboarding_completed_at: "2026-11-01T00:00:00Z" }];
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith("https://consumer.test")) {
          return new Response(JSON.stringify(url.includes("id=gt.") ? page2 : page1), { status: 200 });
        }
        return new Response(null, { status: 201 });
      }),
    );
    const { syncUserSources } = await import("@/lib/revenue-plan/user-sources");
    const r = await syncUserSources({ now: new Date("2026-11-04T06:30:00Z") });

    expect(r).toMatchObject({ mode: "incremental", read: 1001, since: "2026-11-01T06:30:00.000Z" });
    const reads = calls.filter((c) => c.url.startsWith("https://consumer.test"));
    expect(reads).toHaveLength(2);
    expect(reads[0].url).toContain("or=(updated_at.gte.%222026-11-01T06:30:00.000Z%22,joined_at.gte.%222026-11-01T06:30:00.000Z%22)");
    expect(reads[0].url).toContain("order=id.asc&limit=1000");
    expect(reads[0].url).not.toContain("id=gt.");
    expect(reads[1].url).toContain(`id=gt.${uuid(999)}`);

    const writes = calls.filter((c) => c.url.startsWith("https://internal.test"));
    expect(writes).toHaveLength(2);
    expect(writes[0].url).toBe("https://internal.test/rest/v1/user_sources?on_conflict=user_id");
    expect((writes[0].init?.headers as Record<string, string>).Prefer).toContain("resolution=merge-duplicates");
    const body = JSON.parse(String(writes[1].init?.body));
    expect(body).toEqual([
      { user_id: uuid(5000), referral_source: "facebook", onboarding_completed_at: "2026-11-01T00:00:00Z", synced_at: "2026-11-04T06:30:00.000Z" },
    ]);
  });

  it("the full backfill reads every user, with no date filter", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.startsWith("https://consumer.test")
          ? new Response(JSON.stringify([{ id: uuid(1), referral_source: null, onboarding_completed_at: null }]), { status: 200 })
          : new Response(null, { status: 201 });
      }),
    );
    const { syncUserSources } = await import("@/lib/revenue-plan/user-sources");
    const r = await syncUserSources({ full: true });
    expect(r.mode).toBe("full");
    expect(calls[0]).not.toContain("or=(");
  });
});

describe("loadSources", () => {
  it("looks users up in chunks and skips ids that cannot be consumer users", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const ids = decodeURIComponent(url).match(/in\.\(([^)]*)\)/)![1].split(",");
        return new Response(JSON.stringify(ids.map((id) => ({ user_id: id, referral_source: "tiktok" }))), { status: 200 });
      }),
    );
    const { loadSources } = await import("@/lib/revenue-plan/user-sources");
    const ids = [...Array.from({ length: 400 }, (_, i) => uuid(i)), "$RCAnonymousID:abc", uuid(3)];
    const map = await loadSources(ids, "user_sources");
    expect(urls).toHaveLength(3); // 400 unique ids in chunks of 150
    expect(map.size).toBe(400);
    expect(map.get(uuid(7))).toBe("tiktok");
    expect(map.has("$RCAnonymousID:abc")).toBe(false);
  });
});
