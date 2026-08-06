/**
 * Support Inbox — RFC822 → ParsedInbound, shared by both mail transports.
 *
 * IMAP and the Gmail API hand us the same thing (a raw MIME message), so the
 * parsing, the Google-Groups sender recovery and the HTML-only body fallback
 * all live here rather than in either transport. A message must produce an
 * identical row whichever way it arrived — otherwise switching transports
 * silently changes how threads are keyed and who they are attributed to.
 */
import { simpleParser, type AddressObject } from "mailparser";
import { htmlToPlainText } from "./email-text";
import type { AttachmentInfo } from "./types";

export interface ParsedInbound {
  /** IMAP UID; 0 for Gmail-API messages, which key off gmailId instead. */
  uid: number;
  /** Gmail API message id, when that's how the message arrived. */
  gmailId?: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** EFFECTIVE sender — real user resolved through Group/notifier rewrites */
  fromEmail: string | null;
  fromName: string | null;
  /** literal From: header address, before the rewrite fallback */
  rawFromEmail: string | null;
  toEmail: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  attachments: AttachmentInfo[];
  date: Date;
}

/** Our own addresses — a From: carrying one of these is a rewrite, not a user. */
const OWN_ALIASES = new Set([
  "help@dreamme.life",
  "feedback@dreamme.life",
  "dan@dreamme.life",
]);

export function isOwnAlias(email: string | null | undefined): boolean {
  return !!email && OWN_ALIASES.has(email.toLowerCase());
}

/**
 * help@/feedback@ are Google Groups: for external senders Groups rewrites
 * From: to `'Jane Doe' via Dreamme Help <help@dreamme.life>` (DMARC) and
 * keeps the real address in Reply-To / X-Original-Sender. The in-app
 * feedback notifier does the same (From: feedback@, Reply-To: the user).
 * Without this fallback the thread's counterpart becomes our own alias —
 * no account match, and a reply would be addressed to ourselves.
 * Pure — unit-tested.
 */
export function resolveCounterpart(h: {
  fromEmail: string | null;
  fromName: string | null;
  replyToEmail: string | null;
  replyToName: string | null;
  xOriginalSender: string | null;
}): { email: string | null; name: string | null } {
  if (!isOwnAlias(h.fromEmail)) {
    return { email: h.fromEmail, name: h.fromName };
  }
  const real =
    (!isOwnAlias(h.replyToEmail) && h.replyToEmail) ||
    (!isOwnAlias(h.xOriginalSender) && h.xOriginalSender) ||
    null;
  if (!real) return { email: h.fromEmail, name: h.fromName };
  // Prefer the Reply-To display name; else strip the "'X' via Dreamme Help"
  // wrapper from the rewritten From name.
  let name = h.replyToName || null;
  if (!name && h.fromName) {
    const m = h.fromName.match(/^'?(.*?)'?\s+via\s+/i);
    name = m ? m[1] : h.fromName;
  }
  return { email: real.toLowerCase(), name };
}

function firstAddress(
  addr: AddressObject | AddressObject[] | undefined,
): { email: string | null; name: string | null } {
  const obj = Array.isArray(addr) ? addr[0] : addr;
  const first = obj?.value?.[0];
  return {
    email: first?.address?.toLowerCase() ?? null,
    name: first?.name || null,
  };
}

function allAddresses(addr: AddressObject | AddressObject[] | undefined): string {
  const objs = Array.isArray(addr) ? addr : addr ? [addr] : [];
  return objs
    .flatMap((o) => o.value ?? [])
    .map((v) => v.address?.toLowerCase() ?? "")
    .filter(Boolean)
    .join(", ");
}

/** Raw MIME → the row shape both ingest legs insert. */
export async function parseRfc822(
  source: Buffer | string,
  ids: { uid?: number; gmailId?: string | null } = {},
): Promise<ParsedInbound> {
  const parsed = await simpleParser(source);
  const from = firstAddress(parsed.from);
  const replyTo = firstAddress(parsed.replyTo);
  const xOriginalRaw = parsed.headers.get("x-original-sender");
  const counterpart = resolveCounterpart({
    fromEmail: from.email,
    fromName: from.name,
    replyToEmail: replyTo.email,
    replyToName: replyTo.name,
    xOriginalSender:
      typeof xOriginalRaw === "string" ? xOriginalRaw.trim().toLowerCase() : null,
  });
  const refs = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  return {
    uid: ids.uid ?? 0,
    gmailId: ids.gmailId ?? null,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references: refs,
    fromEmail: counterpart.email,
    fromName: counterpart.name,
    rawFromEmail: from.email,
    toEmail: allAddresses(parsed.to) || null,
    subject: parsed.subject ?? null,
    // Apple Mail replies to HTML mail are often HTML-only — derive a text
    // body so triage and the transcript never see "(no body)".
    text:
      parsed.text?.trim() ||
      htmlToPlainText(typeof parsed.html === "string" ? parsed.html : null) ||
      null,
    html: typeof parsed.html === "string" ? parsed.html : null,
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
    date: parsed.date ?? new Date(),
  };
}
