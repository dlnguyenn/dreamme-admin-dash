import { describe, expect, it } from "vitest";
import {
  classifyPerformance,
  computeFromRows,
  summarize,
  type BaselineMap,
  type BaselineRow,
  type PersonaBaseline,
} from "@/lib/baseline";
import { PERSONA_IDS } from "@/lib/personas";

function tsDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function row(
  persona: (typeof PERSONA_IDS)[number],
  views: number,
  daysAgo: number,
): BaselineRow {
  return { persona, view_count: views, posted_at: tsDaysAgo(daysAgo) };
}

describe("baseline.summarize", () => {
  it("returns zero quantiles for empty input", () => {
    const out = summarize([], "2026-01-01T00:00:00Z");
    expect(out.rolling_median_views).toBe(0);
    expect(out.rolling_p25_views).toBe(0);
    expect(out.rolling_p75_views).toBe(0);
    expect(out.sample_size).toBe(0);
  });

  it("computes median, p25, p75 with linear interpolation", () => {
    const out = summarize(
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      "2026-01-01T00:00:00Z",
    );
    expect(out.rolling_median_views).toBe(55);
    expect(out.rolling_p25_views).toBeCloseTo(33, 0);
    expect(out.rolling_p75_views).toBeCloseTo(78, 0);
    expect(out.sample_size).toBe(10);
  });
});

describe("baseline.computeFromRows", () => {
  it("excludes posts older than 30d and fresher than 24h", () => {
    const rows: BaselineRow[] = [
      row("andrea", 1000, 10), // included
      row("andrea", 9000, 5), // included
      row("andrea", 200000, 0.5), // excluded — too fresh (< 24h)
      row("andrea", 5, 60), // excluded — too old (> 30d)
    ];
    const out = computeFromRows(rows);
    const andrea = out.find((b) => b.persona === "andrea");
    expect(andrea?.sample_size).toBe(2);
    expect(andrea?.rolling_median_views).toBe(5000);
  });

  it("emits a row for every persona, even with zero samples", () => {
    const rows: BaselineRow[] = [row("emma", 100, 5)];
    const out = computeFromRows(rows);
    for (const id of PERSONA_IDS) {
      const b = out.find((x) => x.persona === id);
      expect(b).toBeDefined();
    }
    expect(out.find((x) => x.persona === "andrea")?.sample_size).toBe(0);
  });

  it("emits a _global row aggregating across all personas", () => {
    const rows: BaselineRow[] = [
      row("andrea", 1000, 5),
      row("andrea", 2000, 5),
      row("emma", 3000, 5),
      row("emma", 4000, 5),
    ];
    const out = computeFromRows(rows);
    const global = out.find((b) => b.persona === "_global");
    expect(global?.sample_size).toBe(4);
    expect(global?.rolling_median_views).toBe(2500);
  });

  it("ignores rows with missing or zero views or missing posted_at", () => {
    const rows: BaselineRow[] = [
      row("andrea", 1000, 5),
      { persona: "andrea", view_count: null, posted_at: tsDaysAgo(5) },
      { persona: "andrea", view_count: 0, posted_at: tsDaysAgo(5) },
      { persona: "andrea", view_count: 500, posted_at: null },
    ];
    const out = computeFromRows(rows);
    const andrea = out.find((b) => b.persona === "andrea");
    expect(andrea?.sample_size).toBe(1);
  });
});

describe("baseline.classifyPerformance", () => {
  function map(...entries: PersonaBaseline[]): BaselineMap {
    const m: BaselineMap = new Map();
    for (const e of entries) m.set(e.persona, e);
    return m;
  }

  const fullPersona: PersonaBaseline = {
    persona: "andrea",
    rolling_median_views: 100_000,
    rolling_p25_views: 50_000,
    rolling_p75_views: 200_000,
    sample_size: 50,
    window_start: tsDaysAgo(30),
  };

  const fullGlobal: PersonaBaseline = {
    persona: "_global",
    rolling_median_views: 30_000,
    rolling_p25_views: 10_000,
    rolling_p75_views: 80_000,
    sample_size: 200,
    window_start: tsDaysAgo(30),
  };

  it("classifies as flop when ratio < 0.25", () => {
    const cls = classifyPerformance(20_000, "andrea", map(fullPersona, fullGlobal));
    expect(cls.class).toBe("flop");
    expect(cls.ratio).toBeCloseTo(0.2);
  });

  it("classifies as hit when ratio > 2.0", () => {
    const cls = classifyPerformance(250_000, "andrea", map(fullPersona, fullGlobal));
    expect(cls.class).toBe("hit");
    expect(cls.ratio).toBeCloseTo(2.5);
  });

  it("classifies as mid in between", () => {
    const cls = classifyPerformance(100_000, "andrea", map(fullPersona, fullGlobal));
    expect(cls.class).toBe("mid");
    expect(cls.ratio).toBe(1);
  });

  it("falls back to global median when sample_size < 20", () => {
    const cold: PersonaBaseline = {
      persona: "sydney",
      rolling_median_views: 9999, // would say flop, but should be ignored
      rolling_p25_views: 0,
      rolling_p75_views: 0,
      sample_size: 5,
      window_start: tsDaysAgo(30),
    };
    const cls = classifyPerformance(60_000, "sydney", map(cold, fullGlobal));
    // Uses global median 30_000 → ratio 2 → mid (boundary)
    expect(cls.ratio).toBe(2);
    expect(cls.class).toBe("mid");
  });

  it("returns mid + ratio 0 when no usable baseline available", () => {
    const cls = classifyPerformance(100_000, "andrea", new Map());
    expect(cls.ratio).toBe(0);
    expect(cls.class).toBe("mid");
  });
});
