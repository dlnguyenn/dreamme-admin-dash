import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
const pending: Promise<unknown>[] = [];
vi.mock("@/lib/attr-installs", () => ({
  insertClick: vi.fn(async (row: Record<string, unknown>) => {
    inserted.push(row);
  }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

async function hit(path: string, code?: string) {
  const req = new Request(`https://go.dreamme.life${path}`, { headers: { "user-agent": IPHONE, "x-forwarded-for": "203.0.113.9" } });
  if (code !== undefined) {
    const { GET } = await import("@/app/i/[code]/route");
    return GET(req, { params: Promise.resolve({ code }) });
  }
  const { GET } = await import("@/app/l/route");
  return GET(req);
}

describe("invite link /i/<code>", () => {
  beforeEach(() => {
    inserted.length = 0;
    pending.length = 0;
  });

  it("logs an invite click with the code and serves the preview page", async () => {
    const res = await hit("/i/K7M2QPZ", "K7M2QPZ");
    await Promise.all(pending);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Join me on DreamMe");
    expect(html).toContain("https://go.dreamme.life/i/k7m2qpz");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ media_source: "invite", invite_code: "k7m2qpz", creator_code: null, landing: "app_store" });
  });

  it("can't be turned into a Meta click with ?src=meta", async () => {
    await hit("/i/k7m2qpz?src=meta&creator=abc", "k7m2qpz");
    await Promise.all(pending);
    expect(inserted[0]).toMatchObject({ media_source: "invite", creator_code: null });
  });

  it("still sends the friend on with a bad code, logged without one", async () => {
    const res = await hit("/i/nope", "nope");
    await Promise.all(pending);
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ media_source: "invite", invite_code: null });
  });

  it("leaves the ad link as it was", async () => {
    await hit("/l?src=meta&c=123");
    await Promise.all(pending);
    expect(inserted[0]).toMatchObject({ media_source: "meta", campaign_id: "123", invite_code: null });
  });
});
