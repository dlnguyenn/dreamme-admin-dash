import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * While Doublespeed is paused nothing in the DAD may reach its API, and the
 * Overview must not wait on it. The Overview hung for 3 minutes on 2026-11-06
 * when the API stopped answering.
 */
const dsCalls: string[] = [];

beforeEach(() => {
  dsCalls.length = 0;
  vi.resetModules();
  vi.stubEnv("DOUBLESPEED_API_KEY", "ds-test-key");
  vi.stubEnv("DOUBLESPEED_API_BASE", "https://ds.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://ds.test")) {
        dsCalls.push(url);
        return new Promise(() => {}); // never answers, like the real outage
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Range": "0-0/0" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Doublespeed pause", () => {
  it("is on", async () => {
    const { DOUBLESPEED_PAUSED } = await import("@/lib/doublespeedPause");
    expect(DOUBLESPEED_PAUSED).toBe(true);
  });

  it("reports every client as not configured", async () => {
    const { doublespeedConfigured, doublespeedSource } = await import("@/lib/viewsources/doublespeed");
    const { batchStateConfigured } = await import("@/lib/batchState");
    const { doublespeedWriteConfigured } = await import("@/lib/doublespeedWrite");
    expect(doublespeedConfigured()).toBe(false);
    expect(doublespeedSource.configured()).toBe(false);
    expect(batchStateConfigured()).toBe(false);
    expect(doublespeedWriteConfigured()).toBe(false);
  });

  it("refuses direct calls without touching the network", async () => {
    const { dsAccounts, dsPosts } = await import("@/lib/viewsources/doublespeed");
    const { liveDoublespeedPosts, syncBatchPostState, syncMorningPostState } = await import("@/lib/batchState");
    const { setPostStatus } = await import("@/lib/doublespeedWrite");

    await expect(dsAccounts()).rejects.toThrow(/paused/);
    await expect(dsPosts("posted")).rejects.toThrow(/paused/);
    await expect(liveDoublespeedPosts(new Date())).rejects.toThrow(/paused/);
    expect((await syncBatchPostState()).skipped).toBe(true);
    expect((await syncMorningPostState({ batchDate: "2026-11-06" })).skipped).toBe(true);
    expect(await setPostStatus("p1", "scheduled")).toEqual({ ok: false, error: "Doublespeed is paused" });
    expect(dsCalls).toEqual([]);
  });

  it("builds the Overview without waiting on Doublespeed", async () => {
    const { buildOverview } = await import("@/lib/overview");
    const out = await buildOverview();

    expect(dsCalls).toEqual([]);
    expect(out.today).toBeNull();
    expect(out.morning).toBeNull();
    expect(out.queue).toBeNull();
    expect(out.errors.filter((e) => /queue|morning|today/.test(e))).toEqual([]);
    expect(out.ops?.map((c) => c.key)).not.toEqual(expect.arrayContaining(["batch"]));
    expect(out.ops?.map((c) => c.key)).not.toEqual(expect.arrayContaining(["morning"]));
    expect(out.ops?.map((c) => c.key)).not.toEqual(expect.arrayContaining(["views"]));
  });
});
