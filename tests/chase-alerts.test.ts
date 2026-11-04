/**
 * Chase alert parsing (src/lib/finance/chase-alerts.ts), on the alert shapes
 * Chase has used: the HTML table template (Account / Merchant / Amount / Date
 * rows), the older "A charge of ($USD) ... has been authorized" sentence,
 * Zelle, ACH, wires and deposits, plus the noise a real inbox holds (balance
 * alerts, statements, security notices, phishing look-alikes).
 *
 * Fixtures are ported from claude/finance/tests/test_chase_alerts.py, and
 * the expected values match what chase_alerts.py produced for them.
 */
import { describe, expect, it } from "vitest";
import {
  accountFreshness,
  businessRows,
  categorise,
  htmlToText,
  isFromChase,
  looksLikeHtml,
  monthlySpend,
  parseAlert,
  type AlertMessage,
  type AlertTxn,
  type StoredTxn,
} from "@/lib/finance/chase-alerts";
import { messageRowFromRaw, parseStored } from "@/lib/finance/chase-alerts-store";

const CHASE = "Chase <no.reply.alerts@chase.com>";

function tableHtml(title: string, rows: [string, string][]): string {
  const cells = rows
    .map(([k, v]) => `<tr><td style="color:#414042">${k}</td><td style="text-align:right"><b>${v}</b></td></tr>`)
    .join("");
  return (
    `<html><body><table><tr><td><h1>${title}</h1></td></tr>${cells}` +
    "<tr><td>You are receiving this alert because you chose to. " +
    "Review account &gt; Manage alerts</td></tr></table></body></html>"
  );
}

function msg(id: string, subject: string, body: string, date = "Tue, 14 Oct 2026 19:22:05 +0000", from = CHASE): AlertMessage {
  return { id, date, from, subject, body };
}

// A month of realistic alerts for the business accounts.
const INK_PASSIO_1 = msg("m01", "Your $20.00 transaction with PASSIO", tableHtml("You made a $20.00 transaction", [
  ["Account", "Ink Business Cash (...3314)"], ["Date", "Oct 3, 2026 at 9:14 AM ET"], ["Merchant", "PASSIO"], ["Amount", "$20.00"],
]));
const INK_PASSIO_2 = msg("m02", "Your $20.00 transaction with PASSIO", tableHtml("You made a $20.00 transaction", [
  ["Account", "Ink Business Cash (...3314)"], ["Date", "Oct 3, 2026 at 9:15 AM ET"], ["Merchant", "PASSIO"], ["Amount", "$20.00"],
]));
const CARD_META = msg("m03", "Your $1,739.00 transaction with FACEBK *5LKRNXZCE2", tableHtml("You made a $1,739.00 transaction", [
  ["Account", "Chase Business Card (...0352)"], ["Date", "Oct 5, 2026 at 11:02 PM ET"], ["Merchant", "FACEBK *5LKRNXZCE2"], ["Amount", "$1,739.00"],
]));
const OLD_STYLE = msg(
  "m04",
  "Your Single Transaction Alert from Chase",
  "This is an Alert to help you manage your credit card account ending in 3314.\n\n" +
    "As you requested, we are notifying you of any charges over the amount of " +
    "($USD) 0.00, as specified in your Alert settings.\n" +
    "A charge of ($USD) 34.35 at SUPABASE has been authorized on Oct 6, 2026 at 4:01 AM ET.\n",
);
const ZELLE = msg(
  "m05",
  "You sent $550.00 to Xuan Liang",
  "You sent $550.00 to Xuan Liang with Zelle®.\nAccount: Business Complete Checking (...5289)\nDate: Oct 14, 2026\nMemo: october edits",
);
const ACH = msg("m06", "Your ACH debit posted",
  "An ACH debit of $1,343.00 from WISE INC posted to your account ending in 5289 on Oct 9, 2026.");
const WIRE = msg("m07", "Your wire transfer was sent",
  "Your wire transfer of $1,000.00 to PINPRICK LLC was sent from account ending in 5289 on Oct 22, 2026.");
const DEPOSIT = msg("m08", "Your direct deposit posted",
  "A direct deposit of $21,480.55 from APPLE INC posted to your account ending in 5289 on Oct 2, 2026.");
const REFUND = msg("m09", "A credit was posted to your account", tableHtml("A refund of $100.19 posted", [
  ["Account", "Ink Business Cash (...3314)"], ["Date", "Oct 12, 2026"], ["Merchant", "DNH*GODADDY#4081633921R"], ["Amount", "$100.19"],
]));
const CARD_PAYMENT = msg("m10", "Your payment to Chase card ending in 0352 has posted",
  "Your payment of $13,359.66 to Chase card ending in 0352 posted from account ending in 5289.");
const PERSONAL = msg("m11", "Your $84.12 transaction with TRADER JOE S #552", tableHtml("You made a $84.12 transaction", [
  ["Account", "Sapphire Preferred (...5130)"], ["Date", "Oct 4, 2026"], ["Merchant", "TRADER JOE S #552"], ["Amount", "$84.12"],
]));

const NOISE = [
  msg("n1", "Your available balance is $4,638.46", "Your available balance in account ending in 5289 is $4,638.46 as of Oct 14."),
  msg("n2", "Your statement is ready", "Your Ink Business Cash (...3314) statement is ready."),
  msg("n3", "We noticed a new sign-in", "A new device signed in to your account."),
  msg("n4", "Your $739.00 transaction with FACEBK *X",
    "You made a $739.00 transaction with FACEBK *X on account ending in 3314.", undefined, "Chase <alerts@chase-secure-mail.com>"),
  msg("n5", "Your credit card payment is due soon", "Your minimum payment of $40.00 is due Nov 1 on card ending in 3314."),
];

const ALL = [INK_PASSIO_1, INK_PASSIO_2, CARD_META, OLD_STYLE, ZELLE, ACH, WIRE, DEPOSIT, REFUND, CARD_PAYMENT, PERSONAL, ...NOISE];

/** What the cron does with a body: HTML through htmlToText, text as is. */
const parse = (m: AlertMessage) => parseAlert({ ...m, body: looksLikeHtml(m.body) ? htmlToText(m.body) : m.body });

const txnOf = (m: AlertMessage): AlertTxn => {
  const r = parse(m);
  if (r.status !== "txn") throw new Error(`${m.id}: ${r.status} ${r.reason}`);
  return r.txn;
};

const stored = (msgs: AlertMessage[]): StoredTxn[] =>
  msgs.flatMap((m) => {
    const r = parse(m);
    return r.status === "txn" ? [{ ...r.txn, messageId: m.id }] : [];
  });

describe("parseAlert", () => {
  it("reads the HTML table card purchase", () => {
    const t = txnOf(CARD_META);
    expect([t.last4, t.date, t.amount, t.description]).toEqual(["0352", "2026-10-05", -1739, "FACEBK *5LKRNXZCE2"]);
  });

  it("reads the old 'charge of ($USD) ... has been authorized' sentence", () => {
    const t = txnOf(OLD_STYLE);
    expect([t.last4, t.date, t.amount, t.description]).toEqual(["3314", "2026-10-06", -34.35, "SUPABASE"]);
  });

  it("phrases money out of checking like the Chase CSV", () => {
    const expected: Record<string, [number, string, string]> = {
      m05: [-550, "Zelle payment to Xuan Liang", "zelle_out"],
      m06: [-1343, "Online ACH Payment To WISE INC", "ach_out"],
      // Never "WIRE TRANSFER to X": the ~transfer rule would drop the spend.
      m07: [-1000, "ONLINE DOMESTIC WIRE TRANSFER VIA: PINPRICK LLC", "wire_out"],
      m08: [21480.55, "DIRECT DEPOSIT APPLE INC", "deposit"],
    };
    for (const m of [ZELLE, ACH, WIRE, DEPOSIT]) {
      const t = txnOf(m);
      expect(t.last4, m.subject).toBe("5289");
      expect([t.amount, t.description, t.kind], m.subject).toEqual(expected[m.id]);
    }
  });

  it("makes a refund positive and keeps the merchant as its name", () => {
    const t = txnOf(REFUND);
    expect([t.amount, t.last4, t.description]).toEqual([100.19, "3314", "DNH*GODADDY#4081633921R"]);
  });

  it("ignores noise, look-alike senders and card payments", () => {
    for (const m of [...NOISE, CARD_PAYMENT]) {
      expect(parse(m).status, m.subject).toBe("ignore");
    }
    expect(parse(NOISE[3])).toEqual({ status: "ignore", reason: "not from chase.com" });
  });

  it("flags unknown wording with money as unparsed instead of dropping it", () => {
    const weird = msg("w1", "Heads up about your account", "Something for $12.34 happened on account ending in 3314.");
    expect(parse(weird).status).toBe("unparsed");
    // A generic checking "debit transaction" alert has no payee and no known
    // shape yet, so it surfaces too (chase_alerts.py does the same).
    const debit = msg("m07b", "Debit transaction alert",
      "A $1,000.00 debit transaction posted to your account ending in 5289 on Oct 22, 2026.");
    expect(parse(debit)).toEqual({ status: "unparsed", reason: "unknown alert wording: Debit transaction alert" });
  });

  it("falls back to the received date in US Eastern time", () => {
    const m = msg("d1", "Your $5.00 transaction with OPENAI",
      "You made a $5.00 transaction with OPENAI on account ending in 3314.",
      "Wed, 15 Oct 2026 02:30:00 +0000"); // 10:30 PM ET on the 14th
    expect(txnOf(m).date).toBe("2026-10-14");
  });

  it("only trusts chase.com and its subdomains", () => {
    expect(isFromChase("Chase <no.reply.alerts@chase.com>")).toBe(true);
    expect(isFromChase("no.reply.alerts@alerts.chase.com")).toBe(true);
    expect(isFromChase("Chase <alerts@chase-secure-mail.com>")).toBe(false);
    expect(isFromChase("chase.com <x@evil.example>")).toBe(false);
  });
});

describe("raw email -> stored row", () => {
  const eml = (contentType: string, body: string) =>
    "From: Chase <no.reply.alerts@chase.com>\r\nTo: dlnguyenn@gmail.com\r\n" +
    "Subject: Your $20.00 transaction with PASSIO\r\nDate: Fri, 03 Oct 2026 13:14:00 +0000\r\n" +
    `Message-ID: <abc@chase>\r\nMIME-Version: 1.0\r\nContent-Type: ${contentType}; charset=utf-8\r\n\r\n${body}`;

  it("parses an HTML-only alert from the raw message", async () => {
    const row = await messageRowFromRaw("g1", eml("text/html", tableHtml("You made a $20.00 transaction", [
      ["Account", "Ink Business Cash (...3314)"], ["Merchant", "PASSIO"], ["Amount", "$20.00"],
    ])));
    expect([row.status, row.amount, row.last4, row.txn_date, row.description]).toEqual(["txn", -20, "3314", "2026-10-03", "PASSIO"]);
    expect([row.gmail_id, row.message_id, row.from_email]).toEqual(["g1", "<abc@chase>", "no.reply.alerts@chase.com"]);
    expect(row.html_text).toContain("Merchant | PASSIO");
  });

  it("parses a text/plain alert", async () => {
    const row = await messageRowFromRaw("g2", eml("text/plain", OLD_STYLE.body));
    expect([row.status, row.amount, row.description]).toEqual(["txn", -34.35, "SUPABASE"]);
  });

  it("prefers a transaction from either body over an unreadable one", () => {
    const r = parseStored({
      id: "x", from: CHASE, subject: "Your $20.00 transaction with PASSIO", date: "",
      htmlText: "Something odd for $20.00",
      textBody: "Account: Ink Business Cash (...3314)\nMerchant: PASSIO\nAmount: $20.00\nDate: Oct 3, 2026",
    });
    expect(r.status).toBe("txn");
  });
});

describe("businessRows", () => {
  it("turns a month of alerts into business transactions", () => {
    const { rows, personal } = businessRows(stored(ALL));
    expect(rows).toHaveLength(9); // 2 Passio + Meta + Supabase + 4 checking + refund
    expect(rows.filter((r) => r.description === "PASSIO")).toHaveLength(2); // both real
    expect(rows.some((r) => r.description.includes("TRADER JOE"))).toBe(false);
    expect(personal).toEqual(["5130"]);
  });

  it("counts one movement once when two alert kinds report it, but keeps same-kind repeats", () => {
    const wire = { ...txnOf(WIRE), messageId: "m07" };
    // e.g. checking's generic debit alert, once a parser shape exists for it
    const debitTwin: StoredTxn = { ...wire, messageId: "m07b", kind: "card", description: "DEBIT" };
    const rows = businessRows([wire, debitTwin, ...stored([INK_PASSIO_1, INK_PASSIO_2])]).rows;
    expect(rows.filter((r) => r.amount === -1000).map((r) => r.description)).toEqual([
      "ONLINE DOMESTIC WIRE TRANSFER VIA: PINPRICK LLC",
    ]);
    expect(rows.filter((r) => r.description === "PASSIO")).toHaveLength(2);
  });

  it("rolls the employee card up to its parent account", () => {
    const t = txnOf(msg("e1", "Your $12.00 transaction with CANVA", tableHtml("You made a $12.00 transaction", [
      ["Account", "D. NGUYEN (...0360)"], ["Merchant", "CANVA"], ["Amount", "$12.00"], ["Date", "Oct 9, 2026"],
    ])));
    const { rows } = businessRows([{ ...t, messageId: "e1" }]);
    expect(rows.map((r) => [r.last4, r.account, r.date, r.amount, r.description])).toEqual([
      ["0352", "Chase Business Card 0352", "2026-10-09", -12, "CANVA"],
    ]);
  });

  it("skips and reports an unknown account number", () => {
    const t = txnOf(msg("u1", "Your $9.00 transaction with NOTION", tableHtml("You made a $9.00 transaction", [
      ["Account", "Ink Business Preferred (...7781)"], ["Merchant", "NOTION"], ["Amount", "$9.00"], ["Date", "Oct 9, 2026"],
    ])));
    expect(businessRows([{ ...t, messageId: "u1" }])).toEqual({ rows: [], personal: [], unknown: ["7781"] });
  });
});

describe("categories and monthly spend", () => {
  it("categorises like analyze.py and totals October spend", () => {
    const { rows } = businessRows(stored(ALL));
    const cats = Object.fromEntries(rows.map((r) => [r.description, r.category]));
    expect(cats["FACEBK *5LKRNXZCE2"]).toBe("Ad spend - Meta");
    expect(cats["Zelle payment to Xuan Liang"]).toBe("People payments (VERIFY)");
    expect(cats["Online ACH Payment To WISE INC"]).toBe("People payments (VERIFY)");
    expect(cats["ONLINE DOMESTIC WIRE TRANSFER VIA: PINPRICK LLC"]).toBe("People payments (VERIFY)");
    expect(cats["SUPABASE"]).toBe("Infra / hosting");
    expect(cats["PASSIO"]).toBe("AI / LLM APIs");

    const [oct] = monthlySpend(rows);
    expect(oct.month).toBe("2026-10");
    // 20 + 20 + 1739 + 34.35 + 550 + 1343 + 1000; the deposit and refund are not spend
    expect(oct.total).toBeCloseTo(4706.35, 2);
    expect(oct.txns).toBe(7);
    expect(oct.categories[0]).toEqual({ category: "People payments (VERIFY)", total: 2893, txns: 3 });
  });

  it("treats a payment to a business Chase card as an internal transfer", () => {
    expect(categorise("PAYMENT TO CHASE CARD ENDING IN 3314")).toBe("~transfer");
    expect(categorise("PAYMENT TO CHASE CARD ENDING IN 9999")).toBe("Card payment - card NOT exported");
    expect(categorise("Online Transfer to CHK ...1234")).toBe("~transfer");
  });
});

describe("accountFreshness", () => {
  it("flags business accounts with no alert or none in the last 7 days", () => {
    const txns = stored(ALL);
    const fresh = accountFreshness(txns, "2026-10-26");
    expect(Object.fromEntries(fresh.map((a) => [a.last4, [a.lastAlertDate, a.stale]]))).toEqual({
      "5289": ["2026-10-22", false],
      "3314": ["2026-10-12", true],
      "0352": ["2026-10-05", true],
    });
    expect(accountFreshness([], "2026-11-04").every((a) => a.stale && a.lastAlertDate === null)).toBe(true);
  });
});
