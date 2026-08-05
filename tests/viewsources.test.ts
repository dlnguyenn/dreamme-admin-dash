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

describe("sideshiftSource", () => {
  it("reports itself unconfigured so the cron skips it", async () => {
    vi.resetModules();
    const { sideshiftSource } = await import("@/lib/viewsources/sideshift");
    expect(sideshiftSource.configured()).toBe(false);
    // No speculative client: returns empty rather than calling a guessed API.
    await expect(sideshiftSource.listAccounts()).resolves.toEqual([]);
  });
});
