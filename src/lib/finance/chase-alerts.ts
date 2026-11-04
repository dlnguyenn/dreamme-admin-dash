/**
 * Chase alert emails -> business transactions. Pure: no fetch, no env, so the
 * Spend tab and the tests import it directly. The Gmail + Supabase side is
 * src/lib/finance/chase-alerts-store.ts.
 *
 * Port of claude/finance/chase_alerts.py (+ the category RULES from
 * analyze.py). Chase alerts go to dlnguyenn@gmail.com and a Gmail filter
 * forwards them to dan@dreamme.life, which keeps Chase as the sender.
 *
 * Parsing never trusts one exact template. Chase has changed its wording
 * over the years ("A charge of ($USD) 25.00 at X has been authorized", HTML
 * tables with Account / Merchant / Amount rows, "You sent $550.00 to ..."),
 * so fields come from label/value rows first and common sentence shapes
 * second. A Chase email that mentions money but can't be read is stored as
 * `unparsed` and shown on the Spend tab, never silently dropped.
 *
 * Bump PARSER_VERSION after changing anything here: the daily cron re-parses
 * every stored email whose parser_version is older, so a fix also repairs
 * the emails that were unreadable before it.
 */

export const PARSER_VERSION = 1;

export const BUSINESS_ACCOUNTS: Record<string, string> = {
  "5289": "Chase Business Checking 5289",
  "3314": "Chase Ink Business Cash 3314",
  "0352": "Chase Business Card 0352",
};
/** Employee cards bill to a parent account (seen on chase.com 2026-11-04). */
export const CARD_ALIASES: Record<string, string> = { "0360": "0352" };
/** 0773 replaced Sapphire 5130. Card 2888 no longer appears on chase.com. */
export const PERSONAL_LAST4 = new Set(["3966", "5130", "0773", "4433"]);

/** A business account with no alert for this many days gets flagged. */
export const STALE_ACCOUNT_DAYS = 7;

export type AlertKind =
  | "card"
  | "zelle_out"
  | "zelle_in"
  | "wire_out"
  | "deposit"
  | "refund"
  | "ach_out"
  | "withdrawal";

export interface AlertMessage {
  id: string;
  /** Date header, RFC 2822 or ISO */
  date: string;
  from: string;
  subject: string;
  /** plain text; run HTML bodies through htmlToText first */
  body: string;
}

export interface AlertTxn {
  /** YYYY-MM-DD */
  date: string;
  /** signed: negative = money out */
  amount: number;
  description: string;
  kind: AlertKind;
  last4: string;
}

export type ParseResult =
  | { status: "txn"; txn: AlertTxn }
  | { status: "ignore"; reason: string }
  | { status: "unparsed"; reason: string };

// ── Patterns ───────────────────────────────────────────────────────────

// Chase emails that carry no transaction. Balance alerts DO contain dollar
// amounts, so they must be ignored by subject, not by "has no amount".
const NOT_A_TRANSACTION =
  /statement|balance|payment (is )?due|due date|reminder|scheduled|sign[- ]?in|signed in|log ?in|password|security|verification|one-time code|new device|profile|contact info|paperless|card (is|was) (on its way|mailed|activated|locked)|credit (journey|score)|offer|rewards? (summary|points)|limit/i;

// Paying one Chase card from checking, or the card saying it got paid. Both
// sides are business accounts, so it's an internal transfer, and the card's
// purchases are already itemised by their own alerts.
const CARD_PAYMENT =
  /payment (?:of \$[\d,.]+ )?to (?:your )?chase (?:credit )?card|payment (?:has )?posted|received your payment|thank you for your payment|payment thank you/i;

const MONEY = String.raw`\$\s?([\d,]+\.\d{2})`;
// Older card template: "A charge of ($USD) 34.35 at ...". The same email also
// says "charges over the amount of ($USD) 0.00", so anchor on "charge of".
const USD_CHARGE = /charge of \(\$USD\)\s*([\d,]+\.\d{2})/i;
const LAST4 = /(?:ending in|\(\.{2,3}|\.{3}|x{2,}|\*{2,})\s*(\d{4})\b/i;
const MONTH_DATE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i;
const NUM_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Label rows from the HTML-table templates, e.g. "Merchant | PASSIO".
// Order matters: the first label that matches a line claims it.
const LABELS: [key: string, pattern: string][] = [
  ["account", "account"],
  ["amount", "(?:transaction |payment |deposit |transfer )?amount"],
  ["merchant", "merchant|description|paid to|recipient|sent to|to|payee"],
  ["sender", "from|sender|received from"],
  ["date", "(?:transaction |posted |payment )?date|made on"],
];

const re = (src: string) => new RegExp(src, "i");

// Sentence shapes, tried in order. Each yields (kind, sign, merchant group).
const SENTENCES: [AlertKind, 1 | -1, RegExp][] = [
  ["card", -1, /charge of \(\$USD\)\s*[\d,.]+\s+at\s+(.+?)\s+has been authorized/i],
  ["card", -1, re(String.raw`transaction (?:of ${MONEY} )?with\s+(.+?)(?:\s+on\s|\s+was\s|[.\n]|$)`)],
  ["zelle_out", -1, re(String.raw`you sent ${MONEY}\s+to\s+(.+?)(?:\s+with\s+zelle|\s+on\s|[.\n]|$)`)],
  ["zelle_in", 1, re(String.raw`(?:you received|sent you) ${MONEY}(?:\s+from\s+(.+?))?(?:\s+with\s+zelle|\s+on\s|[.\n]|$)`)],
  ["wire_out", -1, re(String.raw`wire (?:transfer )?(?:of ${MONEY} )?(?:to\s+(.+?))?(?:\s+(?:was|has been) sent|[.\n]|$)`)],
  ["deposit", 1, re(String.raw`direct deposit(?: of ${MONEY})?(?:\s+from\s+(.+?))?(?:\s+(?:has )?posted|[.\n]|$)`)],
  ["refund", 1, re(String.raw`(?:refund|return|credit) of ${MONEY}(?:\s+from\s+(.+?))?(?:\s+(?:has )?posted|[.\n]|$)`)],
  ["ach_out", -1, re(String.raw`(?:ach|electronic|external|online) (?:debit|withdrawal|payment|transfer)(?: of ${MONEY})?(?:\s+(?:to|from|by)\s+(.+?))?(?:\s+(?:has )?posted|\s+on\s|[.\n]|$)`)],
  ["withdrawal", -1, re(String.raw`withdrawal of ${MONEY}(?:\s+(?:to|for)\s+(.+?))?(?:\s+(?:has )?posted|\s+on\s|[.\n]|$)`)],
];

const CREDIT_WORDS = /\b(received|deposit|refund|returned|return|credited|credit (?:posted|of))\b/i;

// ── Reading messages ───────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", reg: "®", trade: "™",
  copy: "©", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—",
  hellip: "…", bull: "•", middot: "·", zwnj: "", zwj: "",
};

function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Table cells become ' | ' separated, rows become lines. */
export function htmlToText(body: string): string {
  let s = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/t[dh]>/gi, " | ");
  s = s.replace(/<br\s*\/?>|<\/tr>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = unescapeHtml(s).replace(/ /g, " ");
  return s
    .split(/\r?\n/)
    .map((ln) => ln.replace(/[ \t]+/g, " ").replace(/^[ |]+|[ |]+$/g, ""))
    .filter(Boolean)
    .join("\n");
}

export function looksLikeHtml(body: string): boolean {
  return /<(td|tr|table|div|p|br)\b/i.test(body);
}

/** "Chase <no.reply.alerts@chase.com>" -> "no.reply.alerts@chase.com" */
export function senderAddress(from: string): string {
  const angle = from.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle) return angle[1].toLowerCase();
  const bare = from.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  return bare ? bare[0].toLowerCase() : "";
}

/** Real alerts come from @chase.com or a subdomain. Display names lie. */
export function isFromChase(from: string): boolean {
  const domain = senderAddress(from).split("@").pop() ?? "";
  return domain === "chase.com" || domain.endsWith(".chase.com");
}

// ── Parsing one alert ──────────────────────────────────────────────────

const easternDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Header date (RFC 2822 or ISO) as a US-Eastern calendar date. */
export function receivedDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : easternDate.format(d);
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function textDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = s.match(MONTH_DATE);
  if (m) {
    const iso = isoDate(Number(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]));
    if (iso) return iso;
  }
  const n = s.match(NUM_DATE);
  if (n) {
    let y = Number(n[3]);
    if (y < 100) y += 2000;
    const iso = isoDate(y, Number(n[1]), Number(n[2]));
    if (iso) return iso;
  }
  return null;
}

/** 'Merchant | PASSIO' or 'Merchant: PASSIO' rows -> { merchant: 'PASSIO' }. */
export function labelValues(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [key, pat] of LABELS) {
      let value: string | null = null;
      const m = line.match(new RegExp(String.raw`^\s*(?:${pat})\s*(?:\||:)\s*(.+)$`, "i"));
      if (m) value = m[1];
      else if (new RegExp(String.raw`^\s*(?:${pat})\s*:?\s*$`, "i").test(line) && i + 1 < lines.length) {
        const next = lines[i + 1].replace(/^[ |]+|[ |]+$/g, "");
        if (next) value = next;
      }
      if (value !== null && !(key in found)) found[key] = value.replace(/^[ |]+|[ |]+$/g, "");
    }
  });
  return found;
}

function cleanName(s: string | null | undefined): string {
  let out = (s ?? "").replace(/\s+/g, " ").replace(/^[ .,|]+|[ .,|]+$/g, "");
  out = out.replace(/\s+(?:on|at)\s+\w{3,9}\.? \d{1,2},? \d{4}.*$/, "");
  return out.slice(0, 80);
}

/** Phrase rows the way Chase CSVs do, so the category RULES still match. */
export function describe(kind: AlertKind, name: string | null): string {
  const n = name || "(unknown)";
  switch (kind) {
    case "zelle_out":
      return `Zelle payment to ${n}`;
    case "zelle_in":
      return `Zelle payment from ${n}`;
    // Not "WIRE TRANSFER to": the ~transfer rule reads "TRANSFER TO" as an
    // internal move and would drop the spend.
    case "wire_out":
      return `ONLINE DOMESTIC WIRE TRANSFER VIA: ${n}`;
    case "ach_out":
      return `Online ACH Payment To ${n}`;
    case "deposit":
      return `DIRECT DEPOSIT ${n}`;
    default:
      return n;
  }
}

export function parseAlert(msg: AlertMessage): ParseResult {
  if (!isFromChase(msg.from)) return { status: "ignore", reason: "not from chase.com" };
  const subject = msg.subject ?? "";
  const body = msg.body ?? "";
  // Body first: subjects are terse ("Your ACH debit posted") and would win
  // the leftmost sentence match without the payee name.
  const text = `${body}\n${subject}`;
  if (NOT_A_TRANSACTION.test(subject) && !/transaction|purchase|charge/i.test(subject)) {
    return { status: "ignore", reason: `not a transaction: ${subject.slice(0, 60)}` };
  }
  if (CARD_PAYMENT.test(text)) return { status: "ignore", reason: "card payment (internal transfer)" };

  const fields = labelValues(body);
  const money = re(MONEY);
  const m =
    (fields.amount ?? "").match(money) ?? body.match(USD_CHARGE) ?? subject.match(money) ?? body.match(money);
  if (!m) {
    if (/\$\s?\d/.test(text)) return { status: "unparsed", reason: "dollar sign but no readable amount" };
    return { status: "ignore", reason: `no amount: ${subject.slice(0, 60)}` };
  }
  const amount = Number(m[1].replace(/,/g, ""));

  let kind: AlertKind | null = null;
  let sign: 1 | -1 = -1;
  let name: string | null = null;
  for (const [k, s, pat] of SENTENCES) {
    const sm = text.match(pat);
    if (sm) {
      kind = k;
      sign = s;
      name = sm.slice(1).reverse().find((g) => g && !/^[\d,.]+$/.test(g)) ?? null;
      break;
    }
  }
  if (kind === null) {
    if (!fields.merchant && !fields.sender) {
      return { status: "unparsed", reason: `unknown alert wording: ${subject.slice(0, 60)}` };
    }
    kind = "card";
    sign = CREDIT_WORDS.test(subject) ? 1 : -1;
  }
  // A credit names its sender; if the template only has a Merchant row (a
  // card refund), the merchant is still the best name we have.
  const labelled = sign < 0 ? fields.merchant : fields.sender ?? fields.merchant;
  name = cleanName(labelled ?? name);

  const acct = (fields.account ?? "").match(LAST4) ?? text.match(LAST4);
  if (!acct) return { status: "unparsed", reason: `no account number: ${subject.slice(0, 60)}` };

  const date = textDate(fields.date) ?? textDate(body) ?? receivedDate(msg.date);
  if (!date) return { status: "unparsed", reason: "no date" };

  return {
    status: "txn",
    txn: {
      date,
      amount: Math.round(sign * amount * 100) / 100,
      description: describe(kind, name || null),
      kind,
      last4: acct[1],
    },
  };
}

// ── Business rows ──────────────────────────────────────────────────────

export interface StoredTxn extends AlertTxn {
  messageId: string;
}

export interface BusinessRow extends StoredTxn {
  account: string;
  category: string;
}

export function accountFor(last4: string): { kind: "business"; label: string; last4: string } | { kind: "personal" | "unknown"; last4: string } {
  const l4 = CARD_ALIASES[last4] ?? last4;
  if (BUSINESS_ACCOUNTS[l4]) return { kind: "business", label: BUSINESS_ACCOUNTS[l4], last4: l4 };
  return { kind: PERSONAL_LAST4.has(l4) ? "personal" : "unknown", last4: l4 };
}

/**
 * Business rows, plus personal/unknown account numbers seen.
 *
 * Checking has overlapping alerts: "Debit transaction above $0.01" also fires
 * for a wire, external transfer or bill payment that has its own alert. So
 * one movement can be reported twice ACROSS alert kinds: per (account, date,
 * amount) keep the most rows any single kind reported, preferring a specific
 * kind's wording over a generic card one. Within one kind, repeats are real
 * (4 x $20 PASSIO in a day).
 */
export function businessRows(txns: StoredTxn[]): { rows: BusinessRow[]; personal: string[]; unknown: string[] } {
  const personal = new Set<string>();
  const unknown = new Set<string>();
  const groups = new Map<string, Map<AlertKind, BusinessRow[]>>();
  for (const t of txns) {
    const acct = accountFor(t.last4);
    if (acct.kind !== "business") {
      (acct.kind === "personal" ? personal : unknown).add(acct.last4);
      continue;
    }
    const row: BusinessRow = { ...t, last4: acct.last4, account: acct.label, category: categorise(t.description) };
    const key = `${row.account}|${row.date}|${row.amount.toFixed(2)}`;
    const kinds = groups.get(key) ?? new Map<AlertKind, BusinessRow[]>();
    kinds.set(row.kind, [...(kinds.get(row.kind) ?? []), row]);
    groups.set(key, kinds);
  }
  const rows: BusinessRow[] = [];
  for (const kinds of groups.values()) {
    let best: BusinessRow[] = [];
    for (const rs of kinds.values()) {
      const better =
        rs.length > best.length || (rs.length === best.length && best[0]?.kind === "card" && rs[0].kind !== "card");
      if (better) best = rs;
    }
    rows.push(...best);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account) || a.amount - b.amount);
  return { rows, personal: [...personal].sort(), unknown: [...unknown].sort() };
}

// ── Categories (analyze.py RULES) ──────────────────────────────────────

export const TRANSFER = "~transfer";

// Matched top to bottom; first hit wins. Run against the uppercased
// description.
const RULES: [string, RegExp][] = [
  // Money moving between your own accounts, never counted as spend.
  [TRANSFER, /CHASE CREDIT CRD|AUTOPAY|AUTOMATIC PAYMENT|PAYMENT THANK YOU|PAYMENT - THANK|EPAY|ONLINE TRANSFER|TRANSFER (TO|FROM)|ACCT TRANSFER|CREDIT CARD PAYMENT/],
  ["Ad spend - Meta", /\bFACEBK\b|FACEBOOK|\bMETA\b|META PLATFORMS/],
  ["Ad spend - other", /GOOGLE ADS|TIKTOK ADS|BYTEDANCE|REDDIT ADS|SNAP INC|X CORP|APPLEADS|APPLE ADS|SEARCH ADS/],
  ["AI / LLM APIs", /ANTHROPIC|OPENAI|GOOGLE ?\*?(CLOUD|GEMINI|AI)|GCP|DEEPGRAM|ELEVENLABS|REPLICATE|FAL\.AI|PASSIO/],
  ["Infra / hosting", /SUPABASE|VERCEL|CLOUDFLARE|AWS|AMAZON WEB|HEROKU|DIGITALOCEAN|RAILWAY|RENDER\.COM|NETLIFY|FLY\.IO|HETZNER|TWILIO|650 INDUSTRIES|EXPO/],
  ["Data / scraping", /APIFY|SCRAPECREATORS|SCRAPE CREATORS|BRIGHTDATA|RAPIDAPI|PROXY/],
  ["Content tooling", /DOUBLESPEED|FASTLANE|CANVA|CAPCUT|ADOBE|FIGMA|ELEVEN ?LABS|DESCRIPT|SUBMAGIC|VIDOVO|REACHIFY|HIGGSFIELD|REEL\.FARM|DANSUGC/],
  // Whop hosts the creator/clipper reward programs, so these are UGC payouts.
  ["Creator / UGC payouts", /WHOP/],
  // Money to a named person: contractor, clipper or refund. Its own bucket
  // rather than a guess. Chase wedges a reference number mid-description
  // ("Online ACH Payment 11217122573 To ..."), so "PAYMENT TO" need not touch.
  ["People payments (VERIFY)", /ZELLE PAYMENT[^A-Z]*TO|ONLINE ACH PAYMENT[^A-Z]*TO|WIRE TRANSFER|VENMO PAYMENT/],
  ["Analytics / SaaS", /MIXPANEL|REVENUECAT|AMPLITUDE|POSTHOG|SENTRY|LINEAR|NOTION|SLACK|GITHUB|ATLASSIAN|GOOGLE ?\*?WORKSPACE/],
  ["Apple / stores", /APPLE\.COM|APPLE STORE|ITUNES|APL\*|GOOGLE PLAY|DEVELOPER PROGRAM/],
  ["Contractors / UGC", /UPWORK|FIVERR|DEEL|GUSTO|WISE|PAYPAL|VENMO|REMOTE\.COM|BILL\.COM/],
  ["Legal / accounting", /LEGALZOOM|STRIPE ATLAS|CLERKY|QUICKBOOKS|INTUIT|CARTA|FIRSTBASE|ATTORNEY|\bLLP\b/],
  ["Bank fees", /SERVICE CHARGE|MONTHLY FEE|WIRE FEE|OVERDRAFT|FOREIGN TRANSACTION|ANNUAL MEMBERSHIP|INTEREST CHARGE/],
  ["Software / other", /SUBSCRIPTION|\.COM|\.IO\b|\.AI\b|SAAS/],
];

// "PAYMENT TO CHASE CARD ENDING IN 3314": all three business accounts send
// alerts, so paying one of their cards is internal. A card we don't get
// alerts for is the only record of that spend, so it's kept and flagged.
const CARD_PAYMENT_DESC = /PAYMENT TO CHASE CARD ENDING IN\s*(\d{4})/;

export function categorise(description: string): string {
  const text = description.toUpperCase();
  const card = text.match(CARD_PAYMENT_DESC);
  if (card) return accountFor(card[1]).kind === "business" ? TRANSFER : "Card payment - card NOT exported";
  for (const [name, pat] of RULES) if (pat.test(text)) return name;
  return "Uncategorised";
}

/** Money out that counts as spend: negative and not an internal move. */
export function isSpend(r: BusinessRow): boolean {
  return r.amount < 0 && r.category !== TRANSFER;
}

export interface MonthSpend {
  month: string;
  total: number;
  txns: number;
  categories: { category: string; total: number; txns: number }[];
}

/** Spend per YYYY-MM, categories largest first. */
export function monthlySpend(rows: BusinessRow[]): MonthSpend[] {
  const months = new Map<string, Map<string, { total: number; txns: number }>>();
  for (const r of rows) {
    if (!isSpend(r)) continue;
    const cats = months.get(r.date.slice(0, 7)) ?? new Map();
    const c = cats.get(r.category) ?? { total: 0, txns: 0 };
    c.total += -r.amount;
    c.txns += 1;
    cats.set(r.category, c);
    months.set(r.date.slice(0, 7), cats);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cats]) => {
      const categories = [...cats.entries()]
        .map(([category, v]) => ({ category, total: round2(v.total), txns: v.txns }))
        .sort((a, b) => b.total - a.total);
      return {
        month,
        total: round2(categories.reduce((s, c) => s + c.total, 0)),
        txns: categories.reduce((s, c) => s + c.txns, 0),
        categories,
      };
    });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Health ─────────────────────────────────────────────────────────────

export interface AccountFreshness {
  last4: string;
  label: string;
  lastAlertDate: string | null;
  stale: boolean;
}

/** Last alert date per business account; none or older than STALE_ACCOUNT_DAYS is stale. */
export function accountFreshness(txns: StoredTxn[], today: string): AccountFreshness[] {
  const latest = new Map<string, string>();
  for (const t of txns) {
    const a = accountFor(t.last4);
    if (a.kind === "business" && t.date > (latest.get(a.last4) ?? "")) latest.set(a.last4, t.date);
  }
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - STALE_ACCOUNT_DAYS);
  const staleBefore = cutoff.toISOString().slice(0, 10);
  return Object.entries(BUSINESS_ACCOUNTS).map(([last4, label]) => {
    const lastAlertDate = latest.get(last4) ?? null;
    return { last4, label, lastAlertDate, stale: !lastAlertDate || lastAlertDate < staleBefore };
  });
}

export function easternToday(now: Date = new Date()): string {
  return easternDate.format(now);
}
