/**
 * Tax ledger: turns Chase rows (CSV exports and alert emails) into
 * expense_ledger rows, and totals them. Pure, no I/O; safe in client code.
 *
 * Rows are only ever added, so a category or note someone changed on the Spend
 * tab is never overwritten. The rules here only choose the starting category.
 * When a rule is a guess about purpose (travel, meals, a named person, Amazon)
 * the row also gets a "Needs review" reason, and anything no rule knows goes to
 * Uncategorized rather than being guessed into a deductible bucket.
 */
import { BUSINESS_ACCOUNTS, accountFor } from "./chase-alerts";

export const CATEGORY = {
  advertising: "Advertising",
  contractors: "Contract labor & creators",
  software: "Software & cloud services",
  legal: "Legal & professional",
  fees: "Bank & card fees",
  travel: "Travel",
  meals: "Meals",
  supplies: "Supplies & product samples",
  education: "Education & memberships",
  uncategorized: "Uncategorized",
  income: "Income (bank deposits)",
  transfer: "Transfer (not an expense)",
  owner: "Owner money in (not income)",
  personal: "Personal (not deductible)",
} as const;

export type TaxCategory = (typeof CATEGORY)[keyof typeof CATEGORY];

/** What counts as an expense, in display order. */
export const EXPENSE_CATEGORIES: TaxCategory[] = [
  CATEGORY.advertising,
  CATEGORY.contractors,
  CATEGORY.software,
  CATEGORY.legal,
  CATEGORY.fees,
  CATEGORY.travel,
  CATEGORY.meals,
  CATEGORY.supplies,
  CATEGORY.education,
];
/** Money that isn't an expense. */
export const OTHER_CATEGORIES: TaxCategory[] = [CATEGORY.income, CATEGORY.owner, CATEGORY.transfer, CATEGORY.personal];
export const ALL_CATEGORIES: TaxCategory[] = [...EXPENSE_CATEGORIES, CATEGORY.uncategorized, ...OTHER_CATEGORIES];

export interface LedgerRow {
  date: string;
  account: string;
  description: string;
  amount: number | null;
  category: TaxCategory;
  review: string;
  source: "Chase CSV" | "Chase alert";
  id: string;
}

export interface Classified {
  category: TaxCategory;
  review: string;
}

/** Chase's own fields; only CSV rows have them. */
export interface ChaseHints {
  type?: string;
}

const REVIEW = {
  person: "Who is this and what was it for? A 1099 may be needed.",
  travel: "Business trip? Personal travel is not deductible.",
  meals: "Who and what for? Meals are usually only partly deductible.",
  purchase: "What was this for? Confirm it was a business purchase.",
  membership: "Confirm this was for the business.",
  unknown: "No rule for this merchant. Choose a category.",
};

/** A named person paid through PayPal at or above this gets asked about. */
const PERSON_REVIEW_MIN = 500;

const ok = (category: TaxCategory): Classified => ({ category, review: "" });
const ask = (category: TaxCategory, review: string): Classified => ({ category, review });

// Matched top to bottom against the uppercased description. First hit wins.
const MERCHANT_RULES: [RegExp, Classified][] = [
  [/MONTHLY SERVICE FEE|OVERDRAFT FEE|\bLATE FEE\b|ANNUAL MEMBERSHIP FEE|ACH PMNTS INITIAL FEE|WIRE FEE|FOREIGN TRANSACTION|INTEREST CHARGE/, ok(CATEGORY.fees)],

  [/FACEBK|FACEBOOK|\bMETA PLATFORMS\b|APPLEADS|APPLE ADS|REDDIT INC ADS|REDDIT ADS|GOOGLE \*?ADS|TIKTOK ADS|BYTEDANCE/, ok(CATEGORY.advertising)],

  // Whop sells two different things: creator reward programs and paid courses.
  [/WHOP\*?\s*(CONTENTREWARDS|REACHIFY)/, ok(CATEGORY.contractors)],
  [/WHOP/, ask(CATEGORY.education, REVIEW.membership)],
  [/SIDESHIFT|DANSUGC|FIVERR|UPWORK|CONTRA\.COM|\bWISE (INC|LTD)\b|ORIG CO NAME:WISE|GROWTHMENTOR/, ok(CATEGORY.contractors)],

  // Money to a named person or company, from checking.
  [/ZELLE PAYMENT[^A-Z]*TO|ONLINE ACH PAYMENT[^A-Z]*TO|WIRE TRANSFER/, ask(CATEGORY.contractors, REVIEW.person)],
  [/ORIG CO NAME:(PAYPAL|VANNIASINGH|ANH NGUYEN|ANGEL LYNN|RICHARD MELHADO|ARVIN RUSSELL)/, ok(CATEGORY.contractors)],

  [/ANTHROPIC|CLAUDE\.AI|OPENAI|OPENROUTER|PASSIO|KIE AI|MIDJOURNEY|RUNWAY|RECRAFT|HIGGSFIELD|LIGHTREEL|OPUS CLIP/, ok(CATEGORY.software)],
  [/SUPABASE|VERCEL|CLOUDFLARE|AMAZON WEB|\bAWS\b|HETZNER|TWILIO|650 INDUSTRIES|GOOGLE \*?CLOUD|WORKSPACE|BROWSERSTACK/, ok(CATEGORY.software)],
  [/REVENUECAT|MIXPANEL|SLACK|DISCORD|APIFY|SCRAPE ?CREATORS|DOUBLESPEED|FASTLANE|REEL\.FARM|VIDOVO|ENVATO|DEATH TO STOCK|POSTIZ/, ok(CATEGORY.software)],
  [/SHOPIFY|MAILCHIMP|LINKTREE|MANYCHAT|RIVE INC|APPSCREENS|RORK INC|OBVAIR|APPLAUNCHPAD|SOCIAL GROWTH ENGINEER|GODADDY|CARRD|PAYPRO/, ok(CATEGORY.software)],
  // Apple Developer Program is the $99 APPLE.COM/US charge; Play's is $25.
  [/APPLE\.COM\/US|GOOGLE \*?PLAY/, ok(CATEGORY.software)],
  [/APPLE\.COM\/BILL/, ask(CATEGORY.software, REVIEW.purchase)],

  [/HARVARD BUSINESS SERV|LEGALZOOM|CLERKY|STRIPE ATLAS|QUICKBOOKS|INTUIT|ATTORNEY|\bLLP\b/, ok(CATEGORY.legal)],

  [/ASIANA|AMERICAN AIR|CHASE TRAVEL|TSA PRECHECK|TRAVEL CREDIT|KNOWN TRAVELER|THE EDIT|SELECT HOTELS/, ask(CATEGORY.travel, REVIEW.travel)],
  [/^TST\s?\*|PHO TODAY|WOOGA|CAST IRON POT/, ask(CATEGORY.meals, REVIEW.meals)],
  [/ALIBABA|AMAZON|AMZN|EBAY/, ask(CATEGORY.supplies, REVIEW.purchase)],
  [/STAN (LANIE|MYLEN)|PERSONAL BRAND LAUNCH|PATREON/, ask(CATEGORY.education, REVIEW.membership)],
];

const CARD_PAYMENT = /PAYMENT TO CHASE CARD ENDING IN\s*(\d{4})/;
const OWNER_TRANSFER = /ONLINE TRANSFER FROM (CHK|SAV) \.\.\.(\d{4})/;
const CARD_PAYMENT_RECEIVED = /^PAYMENT THANK YOU|^AUTOMATIC PAYMENT - THANK|^RETURNED PAYMENT|CHASE CREDIT CRD/;

export function classify(description: string, amount: number | null, hints: ChaseHints = {}): Classified {
  const text = description.toUpperCase().replace(/\s+/g, " ").trim();

  // Money moving between our own accounts comes first: none of it is spend.
  if (hints.type === "Payment" || hints.type === "Reversal" || CARD_PAYMENT_RECEIVED.test(text)) return ok(CATEGORY.transfer);
  const card = text.match(CARD_PAYMENT);
  if (card) {
    if (accountFor(card[1]).kind === "business") return ok(CATEGORY.transfer);
    return ask(CATEGORY.uncategorized, `Payment to card ${card[1]}, whose charges are not in this file. Get its statements, or mark it Personal.`);
  }
  const owner = text.match(OWNER_TRANSFER);
  if (owner) {
    if (accountFor(owner[2]).kind === "personal") return ok(CATEGORY.owner);
    return ask(CATEGORY.uncategorized, `Transfer from account ${owner[2]}. Whose account is this?`);
  }

  if (/SYNDIGO/.test(text)) return ask(CATEGORY.uncategorized, "Large ACH debit with unknown purpose. What is this?");
  // Stripe payouts, including the occasional negative one, are revenue.
  if (/ORIG CO NAME:(APPLE|GOOGLE|STRIPE)|FROM: STRIPE|LINK\.COM|^DIRECT DEPOSIT/.test(text)) return ok(CATEGORY.income);

  for (const [pattern, result] of MERCHANT_RULES) {
    if (pattern.test(text)) return result;
  }

  // Anything else through PayPal on a card is a person or small vendor.
  if (/^PAYPAL \*/.test(text)) {
    return Math.abs(amount ?? 0) >= PERSON_REVIEW_MIN ? ask(CATEGORY.contractors, REVIEW.person) : ok(CATEGORY.contractors);
  }

  // A card refund from an unknown merchant stays with the charge it reverses.
  // Other unrecognised money in is more likely revenue, but say so.
  const isCardCredit = hints.type === "Return" || hints.type === "Adjustment";
  if ((amount ?? 0) > 0 && !isCardCredit) return ask(CATEGORY.income, "Unrecognised deposit. Confirm this is income.");
  return ask(CATEGORY.uncategorized, REVIEW.unknown);
}

// ── Row builders ───────────────────────────────────────────────────────

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function accountLabel(last4: string): string {
  return BUSINESS_ACCOUNTS[last4]?.replace(/^Chase /, "") ?? last4;
}

/** Collapses the fixed-width padding Chase puts in ACH descriptions. */
export function cleanDescription(raw: string): string {
  return raw.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export interface CsvTxn {
  last4: string;
  date: string;
  description: string;
  amount: number;
  type?: string;
}

/**
 * The ID includes a counter because identical rows are real: four $20 PASSIO
 * charges in a day are four charges. Re-exporting the same CSV reproduces the
 * same IDs, so nothing is added twice.
 */
export function rowsFromCsv(txns: CsvTxn[]): LedgerRow[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    const description = cleanDescription(t.description);
    const key = `${t.last4}|${t.date}|${t.amount.toFixed(2)}|${description}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const c = classify(description, t.amount, { type: t.type });
    return {
      date: t.date,
      account: accountLabel(t.last4),
      description,
      amount: t.amount,
      category: c.category,
      review: c.review,
      source: "Chase CSV" as const,
      id: `csv:${t.last4}:${t.date}:${hash(key)}:${n}`,
    };
  });
}

export interface AlertTxn {
  gmailId: string;
  last4: string;
  date: string;
  description: string;
  amount: number;
}

/** Same-day repeats this large are worth a look. Small ones are normal usage billing. */
const DUPLICATE_REVIEW_MIN = 100;

export function rowsFromAlerts(txns: AlertTxn[]): LedgerRow[] {
  const counts = new Map<string, number>();
  const keyOf = (t: AlertTxn) => `${t.last4}|${t.date}|${t.amount.toFixed(2)}|${t.description}`;
  for (const t of txns) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1);
  return txns.map((t) => {
    const description = cleanDescription(t.description);
    const c = classify(description, t.amount);
    const repeated = (counts.get(keyOf(t)) ?? 0) > 1 && Math.abs(t.amount) >= DUPLICATE_REVIEW_MIN;
    return {
      date: t.date,
      account: accountLabel(t.last4),
      description,
      amount: t.amount,
      category: c.category,
      review: c.review || (repeated ? "Charged more than once the same day. Check it is not a duplicate." : ""),
      source: "Chase alert" as const,
      id: `alert:${t.gmailId}`,
    };
  });
}

/** A Chase money email the parser couldn't read still gets a row, so it can't be missed. */
export function rowFromUnparsedAlert(m: { gmailId: string; date: string; subject: string | null }): LedgerRow {
  return {
    date: m.date,
    account: "",
    description: cleanDescription(m.subject ?? "Chase email"),
    amount: null,
    category: CATEGORY.uncategorized,
    review: "Chase email could not be read automatically. Fill in the account and amount.",
    source: "Chase alert",
    id: `alert:${m.gmailId}`,
  };
}

export const ALERT_MATCH_DAYS = 4;

/**
 * True when a CSV row is the posted version of an alert already in the sheet:
 * same account and amount within a few days. Alerts carry the approval date,
 * and the CSV the transaction or posting date.
 */
export function matchesAlert(csv: Pick<LedgerRow, "account" | "amount" | "date">, alert: Pick<LedgerRow, "account" | "amount" | "date">): boolean {
  if (csv.account !== alert.account || csv.amount !== alert.amount) return false;
  const days = Math.abs(Date.parse(`${csv.date}T00:00:00Z`) - Date.parse(`${alert.date}T00:00:00Z`)) / 86_400_000;
  return days <= ALERT_MATCH_DAYS;
}

/** RFC 4180: Chase quotes fields, and ACH descriptions can contain commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * One Chase activity download. The account comes from the file name, as in
 * "Chase3314_Activity20261104.CSV" or "chase-business-checking-5289.csv". A
 * personal or unknown account is refused so its charges can't end up here.
 */
export function parseChaseCsv(filename: string, text: string): CsvTxn[] {
  const number = filename.match(/\d{4}/)?.[0];
  if (!number) throw new Error(`${filename}: no account number in the file name`);
  const account = accountFor(number);
  if (account.kind !== "business") throw new Error(`${filename}: ${number} isn't a business account, so it wasn't added`);

  const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const col = (name: string) => headers?.indexOf(name) ?? -1;
  const dateCol = col("Transaction Date") >= 0 ? col("Transaction Date") : col("Posting Date");
  if (dateCol < 0 || col("Description") < 0 || col("Amount") < 0) throw new Error(`${filename}: this doesn't look like a Chase activity CSV`);

  return rows
    .filter((r) => r[dateCol])
    .map((r) => {
      const [m, d, y] = r[dateCol].split("/");
      const amount = Number(r[col("Amount")]);
      if (!y || !Number.isFinite(amount)) throw new Error(`${filename}: can't read the row dated ${r[dateCol]}`);
      return {
        last4: account.last4,
        date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
        description: r[col("Description")],
        amount,
        type: col("Type") >= 0 ? r[col("Type")] : undefined,
      };
    });
}

/**
 * The CSV rows to add: not already in the ledger by ID, and not the posted
 * version of an alert that's there. Each alert absorbs one CSV row, so two real
 * charges can't hide behind one alert.
 */
export function rowsToImport(csvRows: LedgerRow[], existing: Pick<LedgerRow, "id" | "account" | "amount" | "date" | "source">[]): LedgerRow[] {
  const ids = new Set(existing.map((r) => r.id));
  const alerts = existing.filter((r) => r.source === "Chase alert");
  return csvRows.filter((r) => {
    if (ids.has(r.id)) return false;
    const i = alerts.findIndex((a) => matchesAlert(r, a));
    if (i < 0) return true;
    alerts.splice(i, 1);
    return false;
  });
}

// ── Totals and export ──────────────────────────────────────────────────

export interface LedgerEntry extends LedgerRow {
  notes: string;
}

export interface LedgerSummary {
  years: string[];
  /** category -> year -> dollars. Expenses are positive; other categories keep the bank's sign. */
  totals: Record<string, Record<string, number>>;
  /** Categorized expenses plus Uncategorized, per year. */
  expenses: Record<string, number>;
  review: Record<string, { rows: number; moneyOut: number }>;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function ledgerSummary(rows: Pick<LedgerRow, "date" | "amount" | "category" | "review">[]): LedgerSummary {
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const totals: LedgerSummary["totals"] = {};
  const expenses: LedgerSummary["expenses"] = {};
  const review: LedgerSummary["review"] = {};
  for (const r of rows) {
    const year = r.date.slice(0, 4);
    const amount = r.amount ?? 0;
    const isOther = OTHER_CATEGORIES.includes(r.category);
    const byYear = (totals[r.category] ??= {});
    byYear[year] = cents((byYear[year] ?? 0) + (isOther ? amount : -amount));
    if (!isOther) expenses[year] = cents((expenses[year] ?? 0) - amount);
    if (r.review) {
      const open = (review[year] ??= { rows: 0, moneyOut: 0 });
      open.rows++;
      if (amount < 0) open.moneyOut = cents(open.moneyOut - amount);
    }
  }
  return { years, totals, expenses, review };
}

/** A spreadsheet would run text starting with these as a formula, and merchant names come from email. */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function ledgerCsv(rows: LedgerEntry[]): string {
  const header = "Date,Account,Description,Amount,Category,Needs review,Notes,Source";
  const lines = rows.map((r) =>
    [r.date, csvText(r.account), csvText(r.description), r.amount === null ? "" : r.amount.toFixed(2), csvText(r.category), csvText(r.review), csvText(r.notes), r.source].join(","),
  );
  return `${[header, ...lines].join("\n")}\n`;
}
