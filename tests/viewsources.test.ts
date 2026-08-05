import { afterEach, describe, expect, it, vi } from "vitest";
import { firstLine, toPlatform } from "@/lib/viewsources/types";

describe("toPlatform", () => {
  it("maps the vendor's account_type values", () => {
    expect(toPlatform("tiktok")).toBe("tiktok");
    expect(toPlatform("Instagram")).toBe("instagram");
    expect(toPlatform("FACEBOOK")).toBe("facebook");
    expect(toPlatform("youtube")).toBe("youtube");
  });

  it("drops unknown platforms rather than guessing", () => {
    // A wrong platform would silently file the post in the wrong bucket.
    expect(toPlatform("reddit")).toBe(null);
    expect(toPlatform(null)).toBe(null);
    expect(toPlatform(undefined)).toBe(null);
    expect(toPlatform("")).toBe(null);
  });
});

describe("firstLine", () => {
  it("takes the first non-empty line as the hook", () => {
    expect(firstLine("\n\n  the hook  \nsecond line\nthird")).toBe("the hook");
  });

  it("handles empty input", () => {
    expect(firstLine(null)).toBe(null);
    expect(firstLine("")).toBe(null);
    expect(firstLine("   \n  ")).toBe(null);
  });

  it("caps length so a whole caption can't land in the hook column", () => {
    expect(firstLine("x".repeat(500))?.length).toBe(300);
  });
});

/**
 * The adapter reads its config at module load, so the key has to exist before
 * the dynamic import. Each test imports a fresh copy via resetModules.
 */
async function loadSource(key = "ds-test-key") {
  vi.resetModules();
  process.env.DOUBLESPEED_API_KEY = key;
  process.env.DOUBLESPEED_API_BASE = "https://ds.test";
  return (await import("@/lib/viewsources/doublespeed")).doublespeedSource;
}

const post = (id: string, views: number, username = "creator") => ({
  id,
  status: "posted",
  post_time: "2026-08-01T10:00:00.000Z",
  succeeded_at: "2026-08-01T10:05:00.000Z",
  title: `hook for ${id}\nrest of caption`,
  public_post_url: `https://tiktok.com/@${username}/video/${id}`,
  delete_requested: false,
  account: { username, account_type: "tiktok" },
  stats: { views, likes: 1, comments: 2 },
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DOUBLESPEED_API_KEY;
  delete process.env.DOUBLESPEED_API_BASE;
});

describe("doublespeedSource.listPosts", () => {
  it("walks every page and maps stats onto our shape", async () => {
    const pages = [
      { ok: true, page: 1, page_size: 2, total_count: 3, total_pages: 2, posts: [post("a", 100), post("b", 200)] },
      { ok: true, page: 2, page_size: 2, total_count: 3, total_pages: 2, posts: [post("c", 300)] },
    ];
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => pages[urls.length - 1] } as Response;
    }));

    const source = await loadSource();
    const out = await source.listPosts(new Date("2026-07-06T00:00:00Z"));

    expect(out.map((p) => p.sourcePostId)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({
      platform: "tiktok",
      handle: "creator",
      views: 100,
      likes: 1,
      comments: 2,
      // The REST API carries no share count; inventing one would be worse.
      shares: null,
      hook: "hook for a",
      postedAt: "2026-08-01T10:05:00.000Z",
    });
    expect(urls[0]).toContain("status=posted");
    expect(urls[0]).toContain("date_from=2026-07-06");
    expect(urls[1]).toContain("page=2");
  });

  it("de-dupes rows repeated across page boundaries", async () => {
    // A list being written to while paged can hand back the same row twice;
    // the upsert would tolerate it but the reported counts would lie.
    const pages = [
      { ok: true, page: 1, page_size: 2, total_count: 3, total_pages: 2, posts: [post("a", 1), post("b", 2)] },
      { ok: true, page: 2, page_size: 2, total_count: 3, total_pages: 2, posts: [post("b", 2), post("c", 3)] },
    ];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => pages[n++] }) as Response));

    const source = await loadSource();
    const out = await source.listPosts(new Date("2026-07-06T00:00:00Z"));
    expect(out.map((p) => p.sourcePostId)).toEqual(["a", "b", "c"]);
  });

  it("skips posts on an unrecognised platform", async () => {
    const odd = { ...post("z", 9), account: { username: "x", account_type: "reddit" } };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, page: 1, page_size: 2, total_count: 2, total_pages: 1, posts: [post("a", 1), odd] }),
    }) as Response));

    const source = await loadSource();
    const out = await source.listPosts(new Date("2026-07-06T00:00:00Z"));
    expect(out.map((p) => p.sourcePostId)).toEqual(["a"]);
  });

  it("never leaks the API key into an error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Invalid API key",
    }) as Response));

    const source = await loadSource("ds-super-secret-value");
    await expect(source.listPosts(new Date())).rejects.toThrow(/Doublespeed 401/);
    await expect(source.listPosts(new Date())).rejects.not.toThrow(/super-secret/);
  });
});

async function loadSideshift(key = "sk_live_test") {
  vi.resetModules();
  process.env.SIDESHIFT_API_KEY = key;
  process.env.SIDESHIFT_API_BASE = "https://ss.test/api/v1";
  return import("@/lib/viewsources/sideshift");
}

const ssPost = (id: string, views: number, uploadedAt: number, platform = "tiktok") => ({
  id,
  title: `creator hook ${id}\nmore caption`,
  platform,
  views,
  likes: 5,
  comments: 1,
  shares: 2,
  contractorName: "Julia Phillips",
  uploadedAt,
});

describe("sideshift tsToIso", () => {
  /**
   * The API documents "All timestamps are Unix timestamps in milliseconds" and
   * then returns seconds for uploadedAt. Verified live 2026-08-05: 1785878767
   * is 2026-08-04 as seconds, 1970-01-21 as ms. Believing the docs would date
   * every post to 1970 and silently drop them from the 30-day window.
   */
  it("reads a seconds timestamp as seconds despite the docs claiming ms", async () => {
    const { tsToIso } = await loadSideshift();
    expect(tsToIso(1785878767)).toBe("2026-08-04T21:26:07.000Z");
  });

  it("still reads a genuine milliseconds timestamp correctly", async () => {
    const { tsToIso } = await loadSideshift();
    expect(tsToIso(1785878767000)).toBe("2026-08-04T21:26:07.000Z");
  });

  it("returns null for missing or nonsense values", async () => {
    const { tsToIso } = await loadSideshift();
    expect(tsToIso(null)).toBe(null);
    expect(tsToIso(undefined)).toBe(null);
    expect(tsToIso(0)).toBe(null);
    expect(tsToIso(-1)).toBe(null);
  });
});

describe("sideshiftSource.listPosts", () => {
  it("maps creator posts and pages by total", async () => {
    const pages = [
      { data: [ssPost("a", 100, 1785878767), ssPost("b", 200, 1785878579, "instagram")], page: 1, total: 3 },
      { data: [ssPost("c", 300, 1785878317, "facebook")], page: 2, total: 3 },
    ];
    let n = 0;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => pages[n++] } as Response;
    }));

    const { sideshiftSource } = await loadSideshift();
    const out = await sideshiftSource.listPosts(new Date("2026-07-06T00:00:00Z"));

    expect(out.map((p) => p.sourcePostId)).toEqual(["a", "b", "c"]);
    expect(out.map((p) => p.platform)).toEqual(["tiktok", "instagram", "facebook"]);
    expect(out[0]).toMatchObject({
      // The creator who made it, not an account we run.
      handle: "Julia Phillips",
      hook: "creator hook a",
      views: 100,
      shares: 2,
      postUrl: null,
      postedAt: "2026-08-04T21:26:07.000Z",
    });
    expect(urls[0]).toContain("fromDate=2026-07-06");
    expect(urls[0]).toContain("limit=100");
    expect(urls[1]).toContain("page=2");
  });

  it("drops posts that fall outside the requested window", async () => {
    // A server-side fromDate filter and our own reading of uploadedAt can
    // disagree precisely because of the units bug — trust neither alone.
    const old = ssPost("old", 9, 1748000000); // 2025-05
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [ssPost("new", 1, 1785878767), old], page: 1, total: 2 }),
    }) as Response));

    const { sideshiftSource } = await loadSideshift();
    const out = await sideshiftSource.listPosts(new Date("2026-07-06T00:00:00Z"));
    expect(out.map((p) => p.sourcePostId)).toEqual(["new"]);
  });

  it("exposes no accounts — creators are not handles we run", async () => {
    const { sideshiftSource } = await loadSideshift();
    // Creating social_accounts rows for creators would corrupt the
    // "N accounts we run" count, which is a Doublespeed-fleet concept.
    await expect(sideshiftSource.listAccounts()).resolves.toEqual([]);
  });

  it("is skipped by the cron when no key is set", async () => {
    vi.resetModules();
    delete process.env.SIDESHIFT_API_KEY;
    const { sideshiftSource } = await import("@/lib/viewsources/sideshift");
    expect(sideshiftSource.configured()).toBe(false);
  });

  it("never leaks the API key into an error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 402,
      text: async () => '{"error":"Active subscription required"}',
    }) as Response));

    const { sideshiftSource } = await loadSideshift("sk_live_super_secret");
    await expect(sideshiftSource.listPosts(new Date())).rejects.toThrow(/Sideshift 402/);
    await expect(sideshiftSource.listPosts(new Date())).rejects.not.toThrow(/super_secret/);
  });
});
