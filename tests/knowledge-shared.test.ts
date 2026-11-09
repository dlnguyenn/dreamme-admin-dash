import { describe, expect, it } from "vitest";
import {
  isAllowedVaultPath,
  pageSlugFromHref,
  parseFrontmatter,
  parseLog,
  safeEqual,
  snippetFor,
  summaryOf,
  treeFromFiles,
  wikiLinksToMarkdown,
} from "@/lib/knowledge-shared";
import { parseMarkdown } from "@/lib/mini-markdown";

describe("parseFrontmatter", () => {
  it("reads flat keys, lists and booleans, and returns the body", () => {
    const { meta, body } = parseFrontmatter("---\ntitle: Expert feeds\ntags: [a, b]\nprivate: true\nupdated: 2026-11-08\n---\n\n# Hi\n");
    expect(meta).toMatchObject({ title: "Expert feeds", tags: ["a", "b"], private: true, updated: "2026-11-08" });
    expect(body.trim()).toBe("# Hi");
  });
  it("leaves a file without frontmatter alone", () => {
    expect(parseFrontmatter("# Just a page").body).toBe("# Just a page");
  });
});

describe("wiki links", () => {
  it("turns [[page]] and [[page|label]] into in-app links that round-trip", () => {
    const md = wikiLinksToMarkdown("See [[expert-feeds]] and [[meta-ads-strategy|Meta]].");
    expect(md).toBe("See [expert-feeds](/?tab=knowledge&page=expert-feeds) and [Meta](/?tab=knowledge&page=meta-ads-strategy).");
    expect(pageSlugFromHref("/?tab=knowledge&page=expert-feeds")).toBe("expert-feeds");
    expect(pageSlugFromHref("https://example.com")).toBeNull();
  });
});

describe("parseLog", () => {
  it("splits entries and pulls out the linked page", () => {
    const log = parseLog(
      "# Log\n\n## [2026-11-08] change | X switched -> [[expert-feeds]]\n\n- one\n\n## [2026-11-09] note | Plain entry\n\nbody\n",
    );
    expect(log).toEqual([
      { date: "2026-11-08", kind: "change", title: "X switched", page: "expert-feeds", body: "- one" },
      { date: "2026-11-09", kind: "note", title: "Plain entry", page: null, body: "body" },
    ]);
  });
});

describe("isAllowedVaultPath", () => {
  it("allows the readable folders only", () => {
    expect(isAllowedVaultPath("wiki/expert-feeds.md")).toBe(true);
    expect(isAllowedVaultPath("wiki/data/subscription-growth-library-2026-11/dreamme-growth-library.html")).toBe(true);
    expect(isAllowedVaultPath("raw-sources/documents/artifacts/2026-11-09/meagain-playbook.html")).toBe(true);
    expect(isAllowedVaultPath("raw-sources/documents/expert-feeds/2026/2026-11-08-4.md")).toBe(true);
    expect(isAllowedVaultPath("raw-sources/documents/expert-feeds/backfill/linkedin-2025-11-to-2026-11/eric-seufert.md")).toBe(true);
  });
  it("refuses traversal, hidden files and everything else", () => {
    for (const p of [
      "wiki/../.github/workflows/x.yml",
      ".claude-setup/team-sync.js",
      "wiki/.secret.md",
      "raw-sources/memory/user_dan.md",
      "tools/expert-feeds/state.json",
      "wiki//log.md",
      "",
    ]) {
      expect(isAllowedVaultPath(p)).toBe(false);
    }
  });
});

describe("helpers", () => {
  it("summaryOf skips headings and tables", () => {
    expect(summaryOf("# Title\n\n| a | b |\n|---|---|\n\nThe real first paragraph is here and long enough.")).toBe(
      "The real first paragraph is here and long enough.",
    );
  });
  it("snippetFor finds a case-insensitive hit", () => {
    expect(snippetFor("Paywall tests won 97% of the time", "PAYWALL", 5)).toBe("Paywall test…");
    expect(snippetFor("nothing here", "paywall")).toBeNull();
  });
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("mini-markdown blockquotes", () => {
  it("groups > lines into one quote block with inner Markdown", () => {
    const blocks = parseMarkdown("Intro\n\n> **Bold** line\n> second\n>\n> - item\n\nAfter");
    expect(blocks.map((b) => b.t)).toEqual(["p", "quote", "p"]);
    const q = blocks[1] as { t: "quote"; children: { t: string }[] };
    expect(q.children.map((b) => b.t)).toEqual(["p", "ul"]);
  });
});

describe("treeFromFiles (snapshot manifest -> folder listing)", () => {
  const files = [
    { path: "wiki/a.md", size: 3, text: "aaa" },
    { path: "wiki/data/lib/x.html", size: 9 },
    { path: "raw-sources/documents/expert-feeds/2026/2026-11-08.md", size: 5 },
    { path: "raw-sources/documents/expert-feeds/backfill/li/eric.md", size: 7 },
  ];
  it("lists one level with text, and folders as trees", () => {
    const t = treeFromFiles(files, "wiki", 1, true);
    expect(t).toEqual([
      { name: "a.md", type: "blob", size: 3, text: "aaa" },
      { name: "data", type: "tree", size: 0, children: [] },
    ]);
  });
  it("lists two levels and leaves deeper folders empty", () => {
    const t = treeFromFiles(files, "raw-sources/documents/expert-feeds", 2, false);
    expect(t.map((n) => n.name)).toEqual(["2026", "backfill"]);
    expect(t[0].children).toEqual([{ name: "2026-11-08.md", type: "blob", size: 5, text: undefined }]);
    expect(t[1].children).toEqual([{ name: "li", type: "tree", size: 0, children: [] }]);
  });
  it("ignores other folders", () => {
    expect(treeFromFiles(files, "wiki/data", 2, false)).toEqual([
      { name: "lib", type: "tree", size: 0, children: [{ name: "x.html", type: "blob", size: 9, text: undefined }] },
    ]);
  });
});
