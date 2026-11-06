/**
 * Tax ledger categories (src/lib/finance/tax-ledger.ts). The descriptions are
 * real Chase wording from the 2024-2026 exports.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORY,
  classify,
  ledgerCsv,
  ledgerSummary,
  matchesAlert,
  parseChaseCsv,
  rowFromUnparsedAlert,
  rowsFromAlerts,
  rowsFromCsv,
  rowsToImport,
} from "@/lib/finance/tax-ledger";

const cat = (d: string, a: number, hints = {}) => classify(d, a, hints).category;

describe("money that is not spend", () => {
  it("treats card payments as transfers on both sides", () => {
    expect(cat("Payment Thank You - Web", 5000, { type: "Payment" })).toBe(CATEGORY.transfer);
    expect(cat("AUTOMATIC PAYMENT - THANK", 5332.38, { type: "Payment" })).toBe(CATEGORY.transfer);
    expect(cat("Payment to Chase card ending in 3314 09/01", -5007.21)).toBe(CATEGORY.transfer);
    expect(cat("ORIG CO NAME:CHASE CREDIT CRD ORIG ID:4760039224", -5332.38)).toBe(CATEGORY.transfer);
  });

  it("does not count a returned card payment as an expense", () => {
    expect(cat("Returned Payment", -13139.13, { type: "Reversal" })).toBe(CATEGORY.transfer);
  });

  it("marks transfers from personal accounts as owner money, not income", () => {
    expect(cat("Online Transfer from CHK ...3966 transaction#: 29009050939", 7000)).toBe(CATEGORY.owner);
    expect(cat("Online Transfer from SAV ...4433 transaction#: 26150828140", 950)).toBe(CATEGORY.owner);
  });

  it("asks about a transfer from an account we don't know", () => {
    const c = classify("Online Transfer from CHK ...9999 transaction#: 1", 100);
    expect(c.category).toBe(CATEGORY.uncategorized);
    expect(c.review).toContain("9999");
  });

  it("treats store and Stripe payouts as income", () => {
    expect(cat("ORIG CO NAME:Apple Inc ORIG ID:1", 23800)).toBe(CATEGORY.income);
    expect(cat("ORIG CO NAME:GOOGLE ORIG ID:1", 3800)).toBe(CATEGORY.income);
    expect(cat("ORIG CO NAME:STRIPE ORIG ID:4270465600 CO ENTRY DESCR:TRANSFER SEC:CCD", -70.83)).toBe(CATEGORY.income);
    expect(cat("DIRECT DEPOSIT (unknown)", 42.47)).toBe(CATEGORY.income);
  });
});

describe("spend that can't be assumed", () => {
  it("flags a payment to a card with no itemized charges", () => {
    const c = classify("Payment to Chase card ending in 2888 05/13", -5000);
    expect(c.category).toBe(CATEGORY.uncategorized);
    expect(c.review).toContain("2888");
  });

  it("flags Syndigo", () => {
    const c = classify("ORIG CO NAME:Syndigo LLC ORIG ID:0010418248", -24000);
    expect(c.category).toBe(CATEGORY.uncategorized);
    expect(c.review).not.toBe("");
  });

  it("sends an unknown merchant to Uncategorized with a reason", () => {
    const c = classify("SOME NEW VENDOR", -12);
    expect(c.category).toBe(CATEGORY.uncategorized);
    expect(c.review).not.toBe("");
  });

  it("keeps an unknown merchant's refund out of income", () => {
    expect(cat("JACOB GORDON", 500, { type: "Return" })).toBe(CATEGORY.uncategorized);
    expect(cat("SOME UNKNOWN DEPOSIT", 500)).toBe(CATEGORY.income);
  });

  it("flags travel and meals, because they may be personal", () => {
    for (const d of ["ASIANA AIR 9882491857575", "CL *Chase Travel", "TRAVEL CREDIT $300/YEAR"]) {
      expect(classify(d, -10)).toMatchObject({ category: CATEGORY.travel, review: expect.stringContaining("Business trip") });
    }
    expect(classify("TST* SOOTHR - LIC", -431.67).category).toBe(CATEGORY.meals);
    expect(classify("TST* SOOTHR - LIC", -431.67).review).not.toBe("");
  });

  it("flags payments to named people", () => {
    expect(classify("Zelle payment to Xuan Liang 29824166209", -1000).review).toContain("1099");
    expect(classify("Online ACH Payment 11217122573 To ShesThatGirlCoLLCSophia", -7000).review).toContain("1099");
    expect(classify("ONLINE DOMESTIC WIRE TRANSFER VIA: COLUMN NA", -1000).category).toBe(CATEGORY.contractors);
  });

  it("flags larger PayPal payments to a person, but not small ones", () => {
    expect(classify("PAYPAL *JAIRERICH", -900).review).not.toBe("");
    expect(classify("PAYPAL *SHAYESJT1995", -75)).toEqual({ category: CATEGORY.contractors, review: "" });
  });

  it("splits Whop into creator programs and courses", () => {
    expect(classify("WHOP*CONTENTREWARDSHQ", -10000)).toEqual({ category: CATEGORY.contractors, review: "" });
    expect(classify("WHOP*REACHIFY", -3150)).toEqual({ category: CATEGORY.contractors, review: "" });
    expect(classify("WHOP*AI ADS MASTERY", -247).category).toBe(CATEGORY.education);
    expect(classify("WHOP*AI ADS MASTERY", -247).review).not.toBe("");
  });
});

describe("routine categories", () => {
  it.each([
    ["FACEBK *MX5F5E6CE4", CATEGORY.advertising],
    ["APPLEADS-USD", CATEGORY.advertising],
    ["ANTHROPIC", CATEGORY.software],
    ["MIXPANEL, INC", CATEGORY.software],
    ["GOOGLE *Workspace_drea", CATEGORY.software],
    ["APPLE.COM/US", CATEGORY.software],
    ["HARVARD BUSINESS SERVI", CATEGORY.legal],
    ["MONTHLY SERVICE FEE", CATEGORY.fees],
    ["ANNUAL MEMBERSHIP FEE", CATEGORY.fees],
    ["ORIG CO NAME:Wise Inc ORIG ID:9453233521", CATEGORY.contractors],
  ])("%s", (d, expected) => {
    expect(classify(d, -100)).toEqual({ category: expected, review: "" });
  });

  it("names an overdraft as a fee even though it mentions PayPal", () => {
    expect(cat("OVERDRAFT FEE FOR A $150.00 ITEM - DETAILS: ORIG CO NAME:PAYPAL", -34)).toBe(CATEGORY.fees);
  });

  it("keeps a refund in the merchant's category, so it nets down", () => {
    expect(cat("DNH*GODADDY#4081633921R", 100.19, { type: "Return" })).toBe(CATEGORY.software);
  });
});

describe("rows", () => {
  it("gives identical CSV rows different, repeatable IDs", () => {
    const t = { last4: "3314", date: "2026-01-01", description: "PASSIO", amount: -20 };
    const ids = rowsFromCsv([t, t, t, t]).map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
    expect(rowsFromCsv([t, t, t, t]).map((r) => r.id)).toEqual(ids);
  });

  it("cleans Chase's padding and HTML entities", () => {
    const [r] = rowsFromCsv([{ last4: "3314", date: "2026-01-01", description: "APPLAUNCHPAD &amp;   MODOR", amount: -29 }]);
    expect(r.description).toBe("APPLAUNCHPAD & MODOR");
  });

  it("keeps both alerts for a repeated large charge, and flags them", () => {
    const base = { last4: "0352", date: "2026-11-04", description: "MIXPANEL, INC", amount: -140 };
    const rows = rowsFromAlerts([{ ...base, gmailId: "a" }, { ...base, gmailId: "b" }]);
    expect(rows.map((r) => r.id)).toEqual(["alert:a", "alert:b"]);
    expect(rows.every((r) => r.review.includes("duplicate"))).toBe(true);
  });

  it("does not flag small repeats, which are normal usage billing", () => {
    const base = { last4: "3314", date: "2026-01-01", description: "PASSIO", amount: -20 };
    const rows = rowsFromAlerts([{ ...base, gmailId: "a" }, { ...base, gmailId: "b" }]);
    expect(rows.every((r) => r.review === "")).toBe(true);
  });

  it("still writes a row for an email it couldn't read", () => {
    const r = rowFromUnparsedAlert({ gmailId: "x", date: "2026-11-06", subject: "Your payment" });
    expect(r.amount).toBeNull();
    expect(r.review).not.toBe("");
  });

  it("matches a posted CSV row to its alert within a few days", () => {
    const alert = { account: "Business Card 0352", amount: -140, date: "2026-11-04" };
    expect(matchesAlert({ ...alert, date: "2026-11-07" }, alert)).toBe(true);
    expect(matchesAlert({ ...alert, date: "2026-11-20" }, alert)).toBe(false);
    expect(matchesAlert({ ...alert, amount: -141 }, alert)).toBe(false);
  });
});

describe("Chase CSV upload", () => {
  const card = 'Card,Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n3314,11/02/2026,11/03/2026,"FACEBK *MX5F5E6CE4",Professional Services,Sale,-2000.00,\n';
  const checking = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,10/16/2026,"ORIG CO NAME:Syndigo LLC, more",-24000.00,ACH_DEBIT, ,,\n';

  it("reads card and checking layouts", () => {
    expect(parseChaseCsv("Chase3314_Activity20261104.CSV", card)).toEqual([
      { last4: "3314", date: "2026-11-02", description: "FACEBK *MX5F5E6CE4", amount: -2000, type: "Sale" },
    ]);
    expect(parseChaseCsv("chase-business-checking-5289.csv", checking)[0]).toMatchObject({ last4: "5289", date: "2026-10-16", amount: -24000, description: "ORIG CO NAME:Syndigo LLC, more" });
  });

  it("refuses personal accounts and files that aren't Chase activity", () => {
    expect(() => parseChaseCsv("Chase3966_Activity.CSV", checking)).toThrow("isn't a business account");
    expect(() => parseChaseCsv("Chase9999_Activity.CSV", checking)).toThrow("isn't a business account");
    expect(() => parseChaseCsv("expenses.csv", checking)).toThrow("no account number");
    expect(() => parseChaseCsv("Chase3314.csv", "a,b\n1,2\n")).toThrow("doesn't look like");
  });

  it("files an employee card under its parent account", () => {
    expect(parseChaseCsv("Chase0360_Activity.CSV", card)[0].last4).toBe("0352");
  });

  it("adds nothing when the same file is uploaded twice", () => {
    const rows = rowsFromCsv(parseChaseCsv("Chase3314.csv", card));
    expect(rowsToImport(rows, rows)).toEqual([]);
  });

  it("skips a posted charge that an alert already recorded, but only once", () => {
    const account = "Ink Business Cash 3314";
    const alert = { id: "alert:a", account, amount: -29, date: "2026-11-03", source: "Chase alert" as const };
    const csv = rowsFromCsv([
      { last4: "3314", date: "2026-11-04", description: "APIFY", amount: -29 },
      { last4: "3314", date: "2026-11-04", description: "APIFY", amount: -29 },
    ]);
    expect(rowsToImport(csv, [alert])).toHaveLength(1);
  });

  it("adds fees, which never have an alert", () => {
    const csv = rowsFromCsv([{ last4: "5289", date: "2026-11-28", description: "MONTHLY SERVICE FEE", amount: -15 }]);
    expect(rowsToImport(csv, [])).toHaveLength(1);
  });
});

describe("totals", () => {
  const row = (date: string, amount: number | null, category: (typeof CATEGORY)[keyof typeof CATEGORY], review = "") => ({ date, amount, category, review });

  it("nets refunds and keeps non-expenses out of expenses", () => {
    const s = ledgerSummary([
      row("2026-01-01", -100, CATEGORY.software),
      row("2026-01-02", 30, CATEGORY.software),
      row("2026-01-03", -50, CATEGORY.uncategorized),
      row("2026-01-04", 1000, CATEGORY.income),
      row("2026-01-05", -500, CATEGORY.transfer),
      row("2026-01-06", -20, CATEGORY.personal),
      row("2025-06-01", -7, CATEGORY.fees),
    ]);
    expect(s.years).toEqual(["2025", "2026"]);
    expect(s.totals[CATEGORY.software]["2026"]).toBe(70);
    expect(s.expenses).toEqual({ "2025": 7, "2026": 120 });
    expect(s.totals[CATEGORY.income]["2026"]).toBe(1000);
  });

  it("avoids floating point drift", () => {
    const rows = Array.from({ length: 10 }, () => row("2026-01-01", -0.1, CATEGORY.fees));
    expect(ledgerSummary(rows).expenses["2026"]).toBe(1);
  });

  it("counts open review rows", () => {
    const s = ledgerSummary([row("2026-01-01", -100, CATEGORY.meals, "why"), row("2026-01-01", 40, CATEGORY.travel, "why"), row("2026-01-01", -5, CATEGORY.fees)]);
    expect(s.review["2026"]).toEqual({ rows: 2, moneyOut: 100 });
  });
});

describe("CSV download", () => {
  const entry = { date: "2026-01-01", account: "Ink Business Cash 3314", description: "A, B", amount: -5, category: CATEGORY.fees, review: "", notes: 'say "hi"', source: "Chase CSV" as const, id: "x" };

  it("quotes commas and quotes", () => {
    expect(ledgerCsv([entry]).split("\n")[1]).toBe('2026-01-01,Ink Business Cash 3314,"A, B",-5.00,Bank & card fees,,"say ""hi""",Chase CSV');
  });

  it("stops a merchant name from running as a spreadsheet formula", () => {
    expect(ledgerCsv([{ ...entry, description: "=HYPERLINK(1)" }])).toContain("'=HYPERLINK(1)");
  });

  it("leaves an unread amount blank", () => {
    expect(ledgerCsv([{ ...entry, amount: null }]).split("\n")[1]).toContain(',"A, B",,');
  });
});
