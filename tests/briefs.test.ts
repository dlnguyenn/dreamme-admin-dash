import { describe, expect, it } from "vitest";
import { markdownTitle, parseInline, parseMarkdown, safeHref, type ListItem } from "@/lib/mini-markdown";
import { briefLink, briefSlugFromUrl, briefUrlError, normalizeBriefUrl } from "@/lib/roadmap";
import { BRIEFS } from "@/lib/briefs/generated";

describe("parseInline", () => {
  it("splits code, bold and links", () => {
    expect(parseInline("Run `npm test` **now**, see [docs](https://x.dev/a).")).toEqual([
      { t: "text", v: "Run " },
      { t: "code", v: "npm test" },
      { t: "text", v: " " },
      { t: "strong", v: "now" },
      { t: "text", v: ", see " },
      { t: "link", href: "https://x.dev/a", children: [{ t: "text", v: "docs" }] },
      { t: "text", v: "." },
    ]);
  });

  it("keeps an unsafe link as plain text", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x" }, { t: "text", v: ")" }]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/?tab=roadmap")).toBe("/?tab=roadmap");
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, tables and lists", () => {
    const md = [
      "# Title",
      "",
      "Lead line one",
      "continues here.",
      "",
      "## Section",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | `x` |",
      "| 2 | 3 |",
      "",
      "1. First",
      "   - nested one",
      "   - nested two",
      "2. Second",
      "",
      "- bullet",
    ].join("\n");
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "h", "table", "ol", "ul"]);
    expect(blocks[1]).toEqual({ t: "p", children: [{ t: "text", v: "Lead line one continues here." }] });
    const table = blocks[3] as Extract<(typeof blocks)[number], { t: "table" }>;
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][1]).toEqual([{ t: "code", v: "x" }]);
    const ol = blocks[4] as { t: "ol"; items: ListItem[] };
    expect(ol.items).toHaveLength(2);
    expect(ol.items[0].sub?.t).toBe("ul");
    expect((ol.items[0].sub as { items: ListItem[] }).items).toHaveLength(2);
    expect(ol.items[1].sub).toBeNull();
  });

  it("parses the bundled Meta signal brief", () => {
    const md = BRIEFS["meta-signal-fix"];
    expect(markdownTitle(md)).toBe("Meta Signal Fix Brief");
    const blocks = parseMarkdown(md);
    const headings = blocks.filter((b) => b.t === "h").length;
    expect(headings).toBeGreaterThanOrEqual(10);
    expect(blocks.filter((b) => b.t === "table")).toHaveLength(3);
  });
});

describe("brief links", () => {
  it("validates brief_url", () => {
    expect(normalizeBriefUrl("  ")).toBeNull();
    expect(briefUrlError("")).toBeNull();
    expect(briefUrlError(null)).toBeNull();
    expect(briefUrlError("https://dreamme-admin-dash.vercel.app/?tab=roadmap&brief=x")).toBeNull();
    expect(briefUrlError("not a url")).toMatch(/full URL/);
    expect(briefUrlError("ftp://x.dev/a")).toMatch(/https/);
  });

  it("recognises a DAD brief link on this host only", () => {
    const host = "dreamme-admin-dash.vercel.app";
    const link = briefLink(`https://${host}/`, "meta-signal-fix");
    expect(link).toBe(`https://${host}/?tab=roadmap&brief=meta-signal-fix`);
    expect(briefSlugFromUrl(link, host)).toBe("meta-signal-fix");
    expect(briefSlugFromUrl("/?tab=roadmap&brief=meta-signal-fix", host)).toBe("meta-signal-fix");
    expect(briefSlugFromUrl(link, "localhost:3000")).toBeNull();
    expect(briefSlugFromUrl("https://claude.ai/artifact/abc", host)).toBeNull();
    expect(briefSlugFromUrl(`https://${host}/?brief=Bad%20Slug`, host)).toBeNull();
    expect(briefSlugFromUrl(null, host)).toBeNull();
  });
});
