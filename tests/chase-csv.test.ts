import { describe, expect, it } from "vitest";
import {
  categorizeMerchant,
  parseChaseCsv,
  parseCsv,
} from "@/lib/spend/chase-csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("respects quoted fields with embedded commas", () => {
    expect(parseCsv('a,b\n"hello, world",ok\n')).toEqual([
      ["a", "b"],
      ["hello, world", "ok"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsv('a\n"she said ""hi"""\n')).toEqual([
      ["a"],
      ['she said "hi"'],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("categorizeMerchant", () => {
  it("maps known SaaS to specific vendors", () => {
    expect(categorizeMerchant("ANTHROPIC, PBC")).toBe("anthropic");
    expect(categorizeMerchant("APIFY TECHNOLOGIES SE")).toBe("apify");
    expect(categorizeMerchant("VERCEL INC")).toBe("vercel");
    expect(categorizeMerchant("SUPABASE PTE LTD")).toBe("supabase");
    expect(categorizeMerchant("GOOGLE *AI STUDIO")).toBe("google");
    expect(categorizeMerchant("GOOGLE CLOUD PLATFORM")).toBe("google");
    expect(categorizeMerchant("GEMINI API USAGE")).toBe("google");
  });

  it("falls through to business_cc for unknown merchants", () => {
    expect(categorizeMerchant("STARBUCKS #1234")).toBe("business_cc");
    expect(categorizeMerchant("AMAZON WEB SERVICES")).toBe("business_cc");
  });
});

describe("parseChaseCsv", () => {
  const HEADER = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo";

  it("flips negative charges to positive USD and skips payments", () => {
    const csv = [
      HEADER,
      "05/01/2026,05/02/2026,STARBUCKS #1234,Food,Sale,-7.45,",
      "05/01/2026,05/02/2026,Payment Thank You-Mobile,,Payment,500.00,",
      "05/02/2026,05/03/2026,VERCEL INC,Services,Sale,-20.00,",
    ].join("\n");
    const result = parseChaseCsv(csv);
    expect(result.parseErrors).toEqual([]);
    expect(result.skippedNonCharges).toBe(1);
    expect(result.rows).toEqual([
      {
        date: "2026-05-01",
        description: "STARBUCKS #1234",
        amountUsd: 7.45,
        vendor: "business_cc",
        duplicatesApiTracking: false,
      },
      {
        date: "2026-05-02",
        description: "VERCEL INC",
        amountUsd: 20.0,
        vendor: "vercel",
        duplicatesApiTracking: true,
      },
    ]);
  });

  it("returns parse errors for missing required headers", () => {
    const csv = "Foo,Bar\n1,2\n";
    const result = parseChaseCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.parseErrors[0]).toMatch(/missing expected columns/);
  });

  it("tolerates $ and commas in amounts", () => {
    const csv = [
      HEADER,
      `05/01/2026,05/02/2026,"BIG VENDOR, LLC",Services,Sale,"-1,234.56",`,
    ].join("\n");
    const result = parseChaseCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amountUsd).toBe(1234.56);
    expect(result.rows[0].description).toBe("BIG VENDOR, LLC");
  });

  it("flags individual bad rows without dropping the whole file", () => {
    const csv = [
      HEADER,
      "not-a-date,05/02/2026,FOO,,Sale,-1.00,",
      "05/02/2026,05/03/2026,BAR,,Sale,not-a-number,",
      "05/03/2026,05/04/2026,BAZ,,Sale,-3.00,",
    ].join("\n");
    const result = parseChaseCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].description).toBe("BAZ");
    expect(result.parseErrors).toHaveLength(2);
  });
});
