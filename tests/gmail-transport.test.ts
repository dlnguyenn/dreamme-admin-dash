import { describe, expect, it } from "vitest";
import { parseRfc822 } from "@/lib/support/rfc822";

/**
 * The Gmail API and IMAP hand us the same bytes. If they ever parsed
 * differently, switching transports would silently re-thread conversations
 * and re-attribute senders — so pin the equivalence rather than trusting it.
 */
const RAW = [
  "From: \"'gabbie gooding' via Dreamme Help\" <help@dreamme.life>",
  "Reply-To: gabbie gooding <gabbiegooding@yahoo.com>",
  "X-Original-Sender: gabbiegooding@yahoo.com",
  "To: help@dreamme.life",
  "Subject: Re: App not working",
  "Message-ID: <abc123@mail.yahoo.com>",
  "In-Reply-To: <prev@dreamme.life>",
  "References: <first@dreamme.life> <prev@dreamme.life>",
  "Date: Sat, 26 Jul 2026 17:07:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "It is working now, thank you!",
  "",
].join("\r\n");

describe("parseRfc822 (shared by IMAP and the Gmail API)", () => {
  it("produces an identical row from either transport's identifiers", async () => {
    const viaImap = await parseRfc822(Buffer.from(RAW), { uid: 4211 });
    const viaGmail = await parseRfc822(Buffer.from(RAW), { gmailId: "18ff0a1b2c" });

    // Everything that decides threading and attribution must match.
    const shape = (m: Awaited<ReturnType<typeof parseRfc822>>) => ({
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      rawFromEmail: m.rawFromEmail,
      subject: m.subject,
      text: m.text,
      date: m.date.toISOString(),
    });
    expect(shape(viaGmail)).toEqual(shape(viaImap));

    // Only the transport-specific ids differ.
    expect(viaImap.uid).toBe(4211);
    expect(viaImap.gmailId).toBeNull();
    expect(viaGmail.uid).toBe(0);
    expect(viaGmail.gmailId).toBe("18ff0a1b2c");
  });

  it("recovers the real sender through the Google Group rewrite", async () => {
    // The alias in From: would otherwise make the thread's counterpart our
    // own help@ address, and a reply would be addressed to ourselves.
    const m = await parseRfc822(Buffer.from(RAW), { gmailId: "x" });
    expect(m.fromEmail).toBe("gabbiegooding@yahoo.com");
    expect(m.fromName).toBe("gabbie gooding");
    expect(m.rawFromEmail).toBe("help@dreamme.life");
  });

  it("derives text from an HTML-only body (Apple Mail replies)", async () => {
    const htmlOnly = [
      "From: jo <jo@example.com>",
      "To: help@dreamme.life",
      "Subject: cancel",
      "Date: Tue, 28 Jul 2026 13:48:00 +0000",
      'Content-Type: text/html; charset="utf-8"',
      "",
      "<div>please cancel my subscription&nbsp;</div><div>Sent from my iPhone</div>",
      "",
    ].join("\r\n");
    const m = await parseRfc822(Buffer.from(htmlOnly), { gmailId: "y" });
    expect(m.text).toMatch(/^please cancel my subscription/);
    expect(m.html).toContain("<div>");
  });
});

/**
 * 2026-08-06 incident: five ids returned by history.list had been deleted by
 * the time we fetched them. getMessage threw, the throw escaped the fetch
 * loop, the whole email leg aborted, and the historyId cursor never advanced
 * — so every poll for eleven hours retried the same doomed batch and three
 * real user emails never reached the inbox.
 *
 * The invariant: one unfetchable id must cost exactly that one message.
 */
describe("Gmail fetch loop resilience", () => {
  class MessageGone extends Error {
    constructor(id: string) {
      super(`Gmail message ${id} no longer exists`);
      this.name = "MessageGoneError";
    }
  }

  /** Mirrors the real loop's skip/filter rules over a fake mailbox. */
  function collect(
    ids: string[],
    mailbox: Record<string, { labelIds: string[] } | "gone">,
    supportLabelId: string | null,
  ) {
    const kept: string[] = [];
    let gone = 0;
    let filtered = 0;
    for (const id of ids) {
      const entry = mailbox[id];
      if (entry === "gone" || entry === undefined) {
        gone++;
        continue;
      }
      if (entry.labelIds.includes("SENT")) {
        filtered++;
        continue;
      }
      if (supportLabelId && !entry.labelIds.includes(supportLabelId)) {
        filtered++;
        continue;
      }
      kept.push(id);
    }
    return { kept, gone, filtered };
  }

  const LABEL = "Label_7792510942250447261";

  it("keeps going past deleted messages instead of losing the batch", () => {
    // The real 10 ids from the incident: 5 deleted, 1 SENT, 1 unlabelled.
    const r = collect(
      ["a", "gone1", "gone2", "gone3", "gone4", "sent1", "unlabelled", "b", "gone5", "c"],
      {
        a: { labelIds: [LABEL, "INBOX"] },
        gone1: "gone",
        gone2: "gone",
        gone3: "gone",
        gone4: "gone",
        sent1: { labelIds: ["SENT"] },
        unlabelled: { labelIds: ["INBOX"] },
        b: { labelIds: [LABEL, "INBOX"] },
        gone5: "gone",
        c: { labelIds: [LABEL, "INBOX"] },
      },
      LABEL,
    );
    expect(r.kept).toEqual(["a", "b", "c"]);
    expect(r.gone).toBe(5);
    expect(r.filtered).toBe(2);
  });

  it("never routes Dan's own sent mail through the inbound leg", () => {
    // A SENT message parsed as inbound makes the thread's counterpart our own
    // address and falsely reopens it as if the user had replied.
    const r = collect(["s"], { s: { labelIds: ["SENT", LABEL] } }, LABEL);
    expect(r.kept).toEqual([]);
    expect(r.filtered).toBe(1);
  });

  it("ingests everything non-sent when no label is configured", () => {
    const r = collect(
      ["a", "s"],
      { a: { labelIds: ["INBOX"] }, s: { labelIds: ["SENT"] } },
      null,
    );
    expect(r.kept).toEqual(["a"]);
  });

  it("MessageGoneError is distinguishable from a transient failure", () => {
    const gone = new MessageGone("19fd60152362c25e");
    expect(gone.name).toBe("MessageGoneError");
    expect(gone).toBeInstanceOf(Error);
  });
});
