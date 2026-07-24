/**
 * Support Inbox — IMAP ingestion from the dan@dreamme.life Workspace mailbox
 * (which also receives help@ / feedback@ alias mail). Auth is the same Gmail
 * App Password used for SMTP sending (DREAMME_SMTP_PASS).
 *
 * Cursor model: (uidvalidity, last_uid). We fetch UID last_uid+1:* and filter
 * uid > last_uid client-side because an IMAP range like 9999:* always matches
 * at least the highest-UID message. If UIDVALIDITY changes the cursor resets
 * and the unique index on support_messages.message_id absorbs re-reads.
 */
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import type { AttachmentInfo } from "./types";

const IMAP_HOST = "imap.gmail.com";
const IMAP_USER = process.env.SUPPORT_IMAP_USER ?? "dan@dreamme.life";
const IMAP_PASS = process.env.DREAMME_SMTP_PASS ?? "";

/** Max messages ingested per poll — keeps a cold backfill inside maxDuration. */
const MAX_PER_POLL = 50;

export function imapConfigured(): boolean {
  return !!IMAP_USER && !!IMAP_PASS;
}

export interface ImapCursor {
  uidvalidity: number | null;
  lastUid: number | null;
}

export interface ParsedInbound {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromEmail: string | null;
  fromName: string | null;
  toEmail: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  attachments: AttachmentInfo[];
  date: Date;
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

export async function fetchNewMessages(cursor: ImapCursor): Promise<{
  messages: ParsedInbound[];
  cursor: { uidvalidity: number; lastUid: number };
  /** true when MAX_PER_POLL was hit and more mail remains */
  truncated: boolean;
}> {
  if (!imapConfigured()) throw new Error("DREAMME_SMTP_PASS not set");
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  });

  await client.connect();
  try {
    const mailbox = await client.mailboxOpen("INBOX");
    const uidValidity = Number(mailbox.uidValidity ?? 0);
    let sinceUid =
      cursor.uidvalidity === uidValidity && cursor.lastUid ? cursor.lastUid : 0;

    // First run (or UIDVALIDITY reset): don't crawl the whole mailbox —
    // bootstrap from the last 7 days only.
    if (sinceUid === 0) {
      const since = new Date(Date.now() - 7 * 86400_000);
      const uids = await client.search({ since }, { uid: true });
      if (Array.isArray(uids) && uids.length > 0) {
        sinceUid = Math.min(...uids) - 1;
      } else {
        // Nothing recent — start at the end of the mailbox.
        sinceUid = Math.max(0, Number(mailbox.uidNext ?? 1) - 1);
      }
    }

    const messages: ParsedInbound[] = [];
    let maxUid = sinceUid;
    let truncated = false;

    for await (const msg of client.fetch(
      `${sinceUid + 1}:*`,
      { uid: true, source: true },
      { uid: true },
    )) {
      if (msg.uid <= sinceUid) continue; // n:* quirk — see header comment
      if (messages.length >= MAX_PER_POLL) {
        truncated = true;
        break;
      }
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const from = firstAddress(parsed.from);
      const refs = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [];
      messages.push({
        uid: msg.uid,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: refs,
        fromEmail: from.email,
        fromName: from.name,
        toEmail: allAddresses(parsed.to) || null,
        subject: parsed.subject ?? null,
        text: parsed.text ?? null,
        html: typeof parsed.html === "string" ? parsed.html : null,
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
        date: parsed.date ?? new Date(),
      });
      if (msg.uid > maxUid) maxUid = msg.uid;
    }

    return {
      messages,
      cursor: { uidvalidity: uidValidity, lastUid: maxUid },
      truncated,
    };
  } finally {
    await client.logout().catch(() => {});
  }
}
