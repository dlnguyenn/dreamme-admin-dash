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
