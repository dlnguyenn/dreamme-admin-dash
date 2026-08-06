/**
 * Support Inbox — fetch new mail via the Gmail API instead of IMAP.
 *
 * Cursor model: Gmail's historyId. Unlike IMAP's (UIDVALIDITY, UID) this is a
 * real incremental cursor, but Gmail only keeps about a week of history — an
 * older cursor 404s. That is a normal state, not a failure: we fall back to
 * listing recent messages and re-derive the cursor. Duplicate re-reads are
 * absorbed by the unique index on support_messages.message_id, exactly as
 * they are on the IMAP path.
 *
 * Scoping: when SUPPORT_GMAIL_LABEL names a Gmail label (applied by a filter
 * on help@/feedback@ mail), only that label is ingested. Without it we fall
 * back to a recipient query, because ingesting the whole 1,500-message inbox
 * and filtering afterwards is what put vendor mail in the Support Inbox in
 * the first place.
 */
import {
  HistoryExpiredError,
  MessageGoneError,
  getMessage,
  labelIdByName,
  listAddedSince,
  listRecentMessageIds,
  getProfile,
  gmailConfigured,
  supportLabel,
} from "@/lib/vendors/gmail";
import { parseRfc822, type ParsedInbound } from "./rfc822";

/** Matches the IMAP leg's cap — keeps a cold backfill inside maxDuration. */
const MAX_PER_POLL = 50;

/**
 * Fallback scope when no label is configured: mail addressed to a support
 * alias. Narrower than "everything in INBOX", which is the point.
 */
const ALIAS_QUERY =
  "(to:help@dreamme.life OR to:feedback@dreamme.life OR cc:help@dreamme.life)";

export { gmailConfigured };

export interface GmailFetchResult {
  messages: ParsedInbound[];
  historyId: string;
  /** true when MAX_PER_POLL was hit and more mail remains */
  truncated: boolean;
  /** true when the cursor aged out (or was absent) and we listed instead */
  usedFallback: boolean;
  /** ids that no longer exist (deleted since their history record) */
  gone: number;
  /** ids dropped for being SENT mail or outside the support label */
  filtered: number;
}

/**
 * New support mail since `startHistoryId`. Pass null on a cold start; the
 * bootstrap looks back 7 days, matching the IMAP leg's first-run behaviour.
 */
export async function fetchNewGmailMessages(
  startHistoryId: string | null,
): Promise<GmailFetchResult> {
  if (!gmailConfigured()) throw new Error("Gmail API not configured");

  const labelName = supportLabel();
  const labelId = labelName ? await labelIdByName(labelName) : null;
  if (labelName && !labelId) {
    throw new Error(
      `SUPPORT_GMAIL_LABEL="${labelName}" matches no Gmail label — check the name (it is case-insensitive but must match exactly, e.g. "Users/Support")`,
    );
  }

  let ids: string[] = [];
  let historyId = startHistoryId ?? "";
  let usedFallback = false;

  if (startHistoryId) {
    try {
      const res = await listAddedSince(startHistoryId, labelId);
      ids = res.ids;
      historyId = res.historyId;
    } catch (e) {
      if (!(e instanceof HistoryExpiredError)) throw e;
      usedFallback = true;
    }
  } else {
    usedFallback = true;
  }

  if (usedFallback) {
    // Re-derive the cursor BEFORE listing, so anything arriving during the
    // fetch is caught by the next run rather than skipped.
    historyId = (await getProfile()).historyId;
    ids = await listRecentMessageIds({
      labelIds: labelId ? [labelId] : undefined,
      q: labelId ? "newer_than:7d" : `${ALIAS_QUERY} newer_than:7d`,
      max: MAX_PER_POLL,
    });
  }

  const truncated = ids.length > MAX_PER_POLL;
  const messages: ParsedInbound[] = [];
  let gone = 0;
  let filtered = 0;

  for (const id of ids.slice(0, MAX_PER_POLL)) {
    let msg;
    try {
      msg = await getMessage(id);
    } catch (e) {
      // Deleted between the history record and now. Permanent, so skip it —
      // rethrowing would abort the leg, block the cursor, and make every
      // later poll retry the same doomed id forever.
      if (e instanceof MessageGoneError) {
        gone++;
        continue;
      }
      throw e;
    }

    // history.list?labelId= filters history RECORDS, not the messages inside
    // them, so a record touching the support label can carry unrelated
    // messages. Filter on the message's own labels instead.
    if (msg.labelIds.includes("SENT")) {
      filtered++; // Dan's own reply — the sent leg owns these
      continue;
    }
    if (labelId && !msg.labelIds.includes(labelId)) {
      filtered++;
      continue;
    }

    messages.push(await parseRfc822(msg.raw, { gmailId: id }));
  }

  // Oldest first, so a thread's messages insert in conversation order.
  messages.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { messages, historyId, truncated, usedFallback, gone, filtered };
}
