import { describe, expect, it } from "vitest";
import {
  barGeometry,
  barRange,
  dateLabel,
  formatValue,
  inlineParts,
  pickView,
  seriesMax,
  trendPoints,
  type AppAnalyticsReport,
} from "@/lib/app-analytics";
import { CreateSnapshot, Report, firstIssue } from "@/lib/app-analytics-schema";

// Made-up figures: real ones live in the database, never in this repo.
const report = (): AppAnalyticsReport => ({
  version: 1,
  asOf: "2026-01-02",
  sources: "Test events.",
  views: [
    {
      id: "summary",
      label: "Summary",
      sections: [
        {
          id: "top",
          title: "Top",
          blocks: [
            { type: "stats", items: [{ label: "Came back", value: "50%" }] },
            {
              type: "table",
              columns: [
                { label: "Group" },
                { label: "Share", kind: "bar", unit: "%" },
                { label: "Verdict", kind: "status" },
              ],
              rows: [
                ["A", 60, { status: "Pass", tone: "good" }],
                ["B", 40, null],
              ],
            },
            {
              type: "trends",
              unit: "%",
              x: [1, 2, 4],
              series: [{ label: "Meals", values: [80, 60, 40] }],
            },
          ],
        },
      ],
    },
    { id: "cancel", label: "Cancel", sections: [{ id: "c", title: "C", blocks: [{ type: "note", text: "n" }] }] },
  ],
});

describe("formatValue", () => {
  it("prints percentages, signed points and plain numbers", () => {
    expect(formatValue(12.5, "%")).toBe("12.5%");
    expect(formatValue(3, "pts")).toBe("+3");
    expect(formatValue(-20, "pts")).toBe("−20");
    expect(formatValue(0, "pts")).toBe("0");
    expect(formatValue(0.25)).toBe("0.25");
    expect(formatValue(1234)).toBe("1,234");
    expect(formatValue(4, "days")).toBe("4 days");
  });
});

describe("bar scale", () => {
  it("always starts at zero and can be widened", () => {
    expect(barRange([8, 2, 5])).toEqual({ min: 0, max: 8 });
    expect(barRange([8, 2], 100)).toEqual({ min: 0, max: 100 });
    expect(barRange([6, -10])).toEqual({ min: -10, max: 6 });
    expect(barRange([])).toEqual({ min: 0, max: 1 });
  });

  it("draws a positive bar from the left edge in proportion", () => {
    expect(barGeometry(50, { min: 0, max: 100 })).toEqual({ left: 0, width: 50, zero: 0 });
  });

  it("grows a negative bar left from the zero line", () => {
    const g = barGeometry(-20, { min: -20, max: 20 });
    expect(g.zero).toBe(50);
    expect(g.left).toBe(0);
    expect(g.width).toBe(50);
    const pos = barGeometry(10, { min: -20, max: 20 });
    expect(pos.left).toBe(50);
    expect(pos.width).toBe(25);
  });

  it("never draws past the track", () => {
    expect(barGeometry(150, { min: 0, max: 100 }).width).toBe(100);
  });
});

describe("trendPoints", () => {
  it("spaces x by its real values, not by position", () => {
    const pts = trendPoints([1, 2, 4, 8, 10], [100, 50, 50, 0, 0], 100);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1].x).toBeCloseTo(11.11, 1);
    expect(pts[2].x).toBeCloseTo(33.33, 1);
    expect(pts[4]).toEqual({ x: 100, y: 100 });
    expect(pts[1].y).toBe(50);
  });
});

describe("seriesMax", () => {
  it("uses the given top only when it is above the data", () => {
    expect(seriesMax([{ label: "a", values: [10, 60] }], 100)).toBe(100);
    expect(seriesMax([{ label: "a", values: [10, 60] }], 50)).toBe(60);
    expect(seriesMax([{ label: "a", values: [10, 60] }])).toBe(60);
  });
});

describe("dateLabel", () => {
  it("reads the date as a calendar day", () => {
    expect(dateLabel("2026-11-11")).toBe("Nov 11, 2026");
    expect(dateLabel("2026-01-01")).toBe("Jan 1, 2026");
  });
});

describe("pickView", () => {
  it("falls back to the first view for an unknown id", () => {
    expect(pickView(report(), "cancel")?.id).toBe("cancel");
    expect(pickView(report(), "map")?.id).toBe("summary");
    expect(pickView(report(), null)?.id).toBe("summary");
  });
});

describe("inlineParts", () => {
  it("marks backticked names as code", () => {
    expect(inlineParts("Use `meals`, not `meal_logged`.")).toEqual([
      { text: "Use ", code: false },
      { text: "meals", code: true },
      { text: ", not ", code: false },
      { text: "meal_logged", code: true },
      { text: ".", code: false },
    ]);
  });
});

describe("report checks", () => {
  it("accepts a well-formed report", () => {
    expect(Report.safeParse(report()).success).toBe(true);
    expect(CreateSnapshot.safeParse({ payload: report(), title: "Run 1" }).success).toBe(true);
  });

  it("rejects a table row with the wrong number of cells", () => {
    const r = report();
    const table = r.views[0].sections[0].blocks[1];
    if (table.type !== "table") throw new Error("fixture");
    table.rows[1] = ["B", 40];
    const parsed = Report.safeParse(r);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(firstIssue(parsed.error)).toContain("row 2 has 2 cells for 3 columns");
  });

  it("rejects text in a bar column", () => {
    const r = report();
    const table = r.views[0].sections[0].blocks[1];
    if (table.type !== "table") throw new Error("fixture");
    table.rows[0][1] = "sixty";
    const parsed = Report.safeParse(r);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(firstIssue(parsed.error)).toContain('column "Share"');
  });

  it("rejects a series that does not match its x positions", () => {
    const r = report();
    const trends = r.views[0].sections[0].blocks[2];
    if (trends.type !== "trends") throw new Error("fixture");
    trends.series[0].values = [80, 60];
    expect(Report.safeParse(r).success).toBe(false);
  });

  it("rejects duplicate view ids, unknown block types and unknown fields", () => {
    const dup = report();
    dup.views[1].id = "summary";
    expect(Report.safeParse(dup).success).toBe(false);

    const unknownBlock = report() as unknown as { views: { sections: { blocks: unknown[] }[] }[] };
    unknownBlock.views[0].sections[0].blocks.push({ type: "pie", items: [] });
    expect(Report.safeParse(unknownBlock).success).toBe(false);

    expect(Report.safeParse({ ...report(), extra: true }).success).toBe(false);
    expect(Report.safeParse({ ...report(), asOf: "Nov 11" }).success).toBe(false);
  });
});
