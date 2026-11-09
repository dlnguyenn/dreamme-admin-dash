import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dad-cache reads the URL and key at import time.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY", "test-key");

type Row = { key: string; payload: unknown; computed_at: string };
let rows: Row[] = [];
const writes: unknown[] = [];

beforeEach(() => {
  rows = [];
  writes.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify(rows), { status: 200 });
      if (init?.method === "POST") writes.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const policy = { freshMs: 60_000, maxStaleMs: 3_600_000 };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("cached", async () => {
  const { cached } = await import("@/lib/dad-cache");

  it("serves a fresh row without computing", async () => {
    rows = [{ key: "k", payload: { n: 1 }, computed_at: ago(10_000) }];
    const fn = vi.fn(async () => ({ n: 2 }));
    const r = await cached("k", policy, fn);
    expect(r.value).toEqual({ n: 1 });
    expect(r.meta.state).toBe("fresh");
    expect(fn).not.toHaveBeenCalled();
  });

  it("serves a stale row at once and recomputes it in the background", async () => {
    rows = [{ key: "k", payload: { n: 1 }, computed_at: ago(120_000) }];
    const fn = vi.fn(async () => ({ n: 2 }));
    const r = await cached("k", policy, fn);
    expect(r.value).toEqual({ n: 1 });
    expect(r.meta.state).toBe("stale");
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("computes and saves when there is no row or it is too old", async () => {
    rows = [{ key: "k", payload: { n: 1 }, computed_at: ago(7_200_000) }];
    const r = await cached("k", policy, async () => ({ n: 3 }));
    expect(r.value).toEqual({ n: 3 });
    expect(r.meta.state).toBe("computed");
    expect(writes).toHaveLength(1);
  });

  it("falls back to an old row when the recompute fails", async () => {
    rows = [{ key: "k", payload: { n: 1 }, computed_at: ago(7_200_000) }];
    const r = await cached("k", policy, async () => {
      throw new Error("db down");
    });
    expect(r.value).toEqual({ n: 1 });
    expect(r.meta.state).toBe("stale");
  });

  it("recomputes on force even when fresh", async () => {
    rows = [{ key: "k", payload: { n: 1 }, computed_at: ago(1_000) }];
    const r = await cached("k", policy, async () => ({ n: 4 }), { force: true });
    expect(r.value).toEqual({ n: 4 });
  });

  it("throws when there is nothing cached and the compute fails", async () => {
    await expect(
      cached("k", policy, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
