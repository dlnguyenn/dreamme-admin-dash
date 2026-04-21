import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { handleScrape } from "@/lib/handlers/scrape-tiktok";
import { InMemoryHookRepository } from "@/lib/repositories/hook-repository";
import { ocrFirstSlide, categorizeHook } from "@/lib/anthropic";
import { HOOK_CATEGORIES } from "@/lib/hook-categories";
import { cachedOcr } from "../helpers/ocr-cache";

const FIXTURE = path.resolve("tests/fixtures/apify-tiktok.json");

function loadFixture(): unknown[] {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("fixture is not an array");
  return parsed;
}

describe("handleScrape (fixture-driven)", () => {
  let fixture: unknown[];

  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY must be set in .env.local for this test");
    }
    fixture = loadFixture();
    expect(fixture.length).toBeGreaterThan(0);
  });

  it("parses all three personas, OCRs slides, categorizes hooks, upserts rows", async () => {
    const repo = new InMemoryHookRepository();
    const ocr = cachedOcr({
      extract: ocrFirstSlide,
      categorize: categorizeHook,
    });
    const scraper = { run: async () => fixture };

    const req = new Request("http://localhost/api/scrape/tiktok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await handleScrape(req, { scraper, repo, ocr });
    const body = (await res.json()) as {
      ok: true;
      scanned: number;
      upserted: number;
      ocred: number;
      skippedNoSlide: number;
      parseFailed: number;
      errors: string[];
    };

    expect(body.ok).toBe(true);
    expect(body.parseFailed).toBe(0);
    expect(body.scanned).toBeGreaterThan(0);
    expect(body.upserted).toBeGreaterThan(0);
    expect(body.errors).toEqual([]);

    const rows = repo.all();
    expect(rows.length).toBe(body.upserted);

    const personas = new Set(rows.map((r) => r.persona));
    expect(personas.size).toBe(3);
    expect(personas).toEqual(new Set(["andrea", "emma", "olivia"]));

    for (const row of rows) {
      expect(row.post_url).toMatch(/^https?:\/\//);
      expect(row.last_scraped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      if (row.first_slide_url) {
        expect(row.first_slide_text.length).toBeGreaterThan(0);
        expect(row.hook_normalized.length).toBeGreaterThan(0);
        expect(row.category).not.toBeNull();
        expect(HOOK_CATEGORIES).toContain(row.category!);
      }
    }

    console.log(
      `cache misses: ocr=${ocr.stats().extractMisses} cat=${ocr.stats().categorizeMisses}`,
    );
  });

  it("reuses prior hook+category on second run (no OCR calls)", async () => {
    const repo = new InMemoryHookRepository();
    const ocr = cachedOcr({
      extract: ocrFirstSlide,
      categorize: categorizeHook,
    });
    const scraper = { run: async () => fixture };
    const req = () =>
      new Request("http://localhost/api/scrape/tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

    await handleScrape(req(), { scraper, repo, ocr });
    const firstSize = repo.size();

    const second = await handleScrape(req(), { scraper, repo, ocr });
    const secondBody = (await second.json()) as { ocred: number; upserted: number };

    expect(secondBody.ocred).toBe(0);
    expect(secondBody.upserted).toBe(firstSize);
  });
});
