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
import { parseRfc822, type ParsedInbound } from "./rfc822";

// Parsing and sender recovery are shared with the Gmail-API transport, so a
// message produces the same row whichever way it arrived. Re-exported here
// because callers (and tests) have always imported them from this module.
export {
  isOwnAlias,
  resolveCounterpart,
  parseRfc822,
  type ParsedInbound,
} from "./rfc822";

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

export async function fetchNewMessages(
  cursor: ImapCursor,
  mailboxPath: string = "INBOX",
): Promise<{
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
    const mailbox = await client.mailboxOpen(mailboxPath);
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
      messages.push(await parseRfc822(msg.source, { uid: msg.uid }));
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
