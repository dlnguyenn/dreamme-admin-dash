/**
 * Support Inbox — ingestion orchestration, shared by the cron route and the
 * UI "Poll now" button.
 *
 * Three legs, each independently fault-tolerant:
 *  1. IMAP poll of the dan@dreamme.life INBOX  → support_threads/messages
 *  2. Consumer public.feedback poll            → support_threads/messages
 *  3. Triage every thread still in status 'new' → drafts + status flip
 *
 * Idempotency: unique message_id / feedback_id indexes + ignore-duplicates
 * upserts; a failed triage leaves the thread in 'new' so mail is never lost.
 */
import {
  getCursor,
  saveCursor,
  spGet,
  spPost,
  spPatch,
  patchThread,
} from "./db";
import { fetchNewMessages, imapConfigured, type ParsedInbound } from "./imap";
import { fetchNewGmailMessages, gmailConfigured } from "./gmail-ingest";
import {
  labelIdByName,
  pushTopic,
  supportLabel,
  watchMailbox,
} from "@/lib/vendors/gmail";
import { checkIngestHealth } from "./health";
import {
  consumerDbConfigured,
  fetchFeedbackSince,
  type ConsumerFeedbackRow,
} from "./consumer-db";
import { resolveUser } from "./resolve-user";
import { refreshStripeNameIndex } from "./stripe-names";
import { isFeedbackMirror, triageThread } from "./triage";
import type {
  SupportDraftRow,
  SupportMessageRow,
  SupportThreadRow,
} from "./types";

const EMAIL_CURSOR_ID = "gmail-inbox";       // IMAP transport (uid cursor)
const GMAIL_CURSOR_ID = "gmail-api-inbox";   // Gmail API transport (historyId)
const SENT_CURSOR_ID = "gmail-sent";
const FEEDBACK_CURSOR_ID = "consumer-feedback";
/** First feedback run only looks back this far (older rows are stale). */
const FEEDBACK_BOOTSTRAP_DAYS = 14;
/** Max threads triaged per run (each is an Anthropic call). */
const MAX_TRIAGE_PER_RUN = 10;
/** Gmail push watch registration; last_seen_at holds the watch expiration. */
const WATCH_CURSOR_ID = "gmail-watch";
/** Run-serialization lock; updated_at holds when the run started. */
const LOCK_CURSOR_ID = "ingest-lock";
/**
 * A lock older than this is a crashed run, not a running one — matches the
 * routes' maxDuration so a live run can never be stolen from.
 */
const LOCK_TTL_MS = 5 * 60_000;

export interface IngestReport {
  emailsFetched: number;
  emailsInserted: number;
  /** Dan's replies sent from Gmail, matched onto existing threads */
  sentFetched: number;
  sentMatched: number;
  feedbackFetched: number;
  feedbackInserted: number;
  threadsTriaged: number;
  /** Stripe billing-name index (powers "Maybe this user?") */
  namesScanned: number;
  namesIndexed: number;
  triageErrors: string[];
  legErrors: string[];
  /** set when ingestion looks stalled rather than the mailbox being quiet */
  healthAlert?: string | null;
}

// ---------------------------------------------------------------------------
// Thread matching helpers

/** Strip Re:/Fwd:/Fw: prefixes + whitespace, casefold. Exported for tests. */
export function normalizeSubject(subject: string | null): string {
  return (subject ?? "")
    .replace(/^(\s*(re|fwd?|aw)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

async function findThreadByReferences(ids: string[]): Promise<string | null> {
  // Message-IDs contain <>@" etc — strip quotes, quote each value, and
  // URL-encode the whole PostgREST filter value (the server decodes it
  // before parsing).
  const clean = ids.filter(Boolean).map((x) => x.replace(/"/g, ""));
  if (!clean.length) return null;
  const quoted = clean.map((x) => `"${x}"`).join(",");

  const byId = await spGet<Pick<SupportMessageRow, "thread_id">[]>(
    `support_messages?select=thread_id&message_id=${encodeURIComponent(`in.(${quoted})`)}&limit=1`,
  );
  if (byId[0]) return byId[0].thread_id;

  const byRefs = await spGet<Pick<SupportMessageRow, "thread_id">[]>(
    `support_messages?select=thread_id&references_ids=${encodeURIComponent(`ov.{${quoted}}`)}&limit=1`,
  );
  return byRefs[0]?.thread_id ?? null;
}

async function findThreadBySenderSubject(
  email: string | null,
  subject: string | null,
): Promise<string | null> {
  if (!email) return null;
  const norm = normalizeSubject(subject);
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await spGet<SupportThreadRow[]>(
    `support_threads?source=eq.email&counterpart_email=eq.${encodeURIComponent(email.toLowerCase())}&last_message_at=gte.${encodeURIComponent(cutoff)}&order=last_message_at.desc&limit=10`,
  );
  const hit = rows.find((t) => normalizeSubject(t.subject) === norm);
  return hit?.id ?? null;
}

/** Reopen semantics for fresh inbound on an existing thread. */
function inboundThreadPatch(sentAtIso: string): Record<string, unknown> {
  return {
    last_message_at: sentAtIso,
    last_inbound_at: sentAtIso,
    unread: true,
    status: "new",
    snoozed_until: null,
  };
}

// ---------------------------------------------------------------------------
// Leg 1 — email

/**
 * Prefer the Gmail API when it's configured, else the legacy IMAP path.
 * Both produce identical rows (see support/rfc822.ts), so this is a
 * transport swap and nothing downstream needs to know which ran.
 */
async function ingestEmail(report: IngestReport): Promise<void> {
  if (gmailConfigured()) return ingestEmailViaGmail(report);
  return ingestEmailViaImap(report);
}

/**
 * Gmail API leg. The historyId cursor only advances when every message in
 * the batch inserted — same rule as IMAP, so a failure is retried next run
 * rather than silently skipped.
 */
async function ingestEmailViaGmail(report: IngestReport): Promise<void> {
  const cursorRow = await getCursor(GMAIL_CURSOR_ID);
  const { messages, historyId, truncated, usedFallback, gone, filtered } =
    await fetchNewGmailMessages(cursorRow?.history_id ?? null);
  report.emailsFetched = messages.length;
  if (gone) {
    report.legErrors.push(
      `email: ${gone} message(s) deleted before we read them — skipped`,
    );
  }
  if (filtered) {
    report.legErrors.push(
      `email: ${filtered} message(s) skipped (sent mail or outside the support label)`,
    );
  }

  let failed = false;
  for (const msg of messages) {
    try {
      const inserted = await insertEmailMessage(msg);
      if (inserted) report.emailsInserted++;
    } catch (e) {
      failed = true;
      report.legErrors.push(
        `email ${msg.gmailId ?? "?"}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (!failed) {
    await saveCursor({
      id: GMAIL_CURSOR_ID,
      uidvalidity: null,
      last_uid: null,
      history_id: historyId,
      last_seen_at: new Date().toISOString(),
      // Advancing clears any stuck-cursor warning, so a recovery followed by
      // a fresh stall alerts again instead of being suppressed as a repeat.
      alerted_at: null,
    });
  }
  if (usedFallback && cursorRow?.history_id) {
    // Worth surfacing: it means the poller was down long enough for Gmail to
    // drop the history, so the window between then and now was covered by a
    // 7-day list rather than an exact diff.
    report.legErrors.push(
      "email: Gmail history cursor expired — re-listed the last 7 days",
    );
  }
  if (truncated) {
    report.legErrors.push("email: poll cap hit — more mail on next run");
  }
}

async function ingestEmailViaImap(report: IngestReport): Promise<void> {
  if (!imapConfigured()) {
    report.legErrors.push("email: DREAMME_SMTP_PASS not set — skipped");
    return;
  }
  const cursorRow = await getCursor(EMAIL_CURSOR_ID);
  const { messages, cursor, truncated } = await fetchNewMessages({
    uidvalidity: cursorRow?.uidvalidity ?? null,
    lastUid: cursorRow?.last_uid ?? null,
  });
  report.emailsFetched = messages.length;

  let firstFailedUid: number | null = null;
  for (const msg of messages) {
    try {
      const inserted = await insertEmailMessage(msg);
      if (inserted) report.emailsInserted++;
    } catch (e) {
      if (firstFailedUid === null) firstFailedUid = msg.uid;
      report.legErrors.push(
        `email uid ${msg.uid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Never advance the cursor past a failed insert — those messages must be
  // retried next run (duplicate re-inserts are absorbed by the unique
  // message_id index).
  const advanceTo =
    firstFailedUid !== null
      ? Math.min(firstFailedUid - 1, cursor.lastUid)
      : cursor.lastUid;
  const prevUid = cursorRow?.last_uid ?? 0;
  if (advanceTo > prevUid || cursorRow?.uidvalidity !== cursor.uidvalidity) {
    await saveCursor({
      id: EMAIL_CURSOR_ID,
      uidvalidity: cursor.uidvalidity,
      last_uid: Math.max(advanceTo, 0),
      last_seen_at: null,
    });
  }
  if (truncated) {
    report.legErrors.push("email: poll cap hit — more mail on next run");
  }
}

/** Returns true when the message was new (not a duplicate). */
async function insertEmailMessage(msg: ParsedInbound): Promise<boolean> {
  const refIds = [
    ...msg.references,
    ...(msg.inReplyTo ? [msg.inReplyTo] : []),
  ];
  // Dedupe check via the unique message_id index happens on insert; find the
  // thread first so a brand-new message lands in the right place.
  let threadId = await findThreadByReferences([
    ...(msg.messageId ? [msg.messageId] : []),
    ...refIds,
  ]);
  if (threadId) {
    // If the messageId itself matched, this is a duplicate — the insert
    // below resolves that via ignore-duplicates.
  } else {
    threadId = await findThreadBySenderSubject(msg.fromEmail, msg.subject);
  }

  const sentAt = msg.date.toISOString();
  let isNewThread = false;
  if (!threadId) {
    const channel = (msg.toEmail ?? "").includes("feedback@dreamme.life")
      ? "feedback"
      : "help";
    // Notifier mirrors of in-app feedback park as 'ignored' immediately —
    // the feedback-table leg carries the real thread. A user replying on a
    // mirror later reopens it via the normal inbound path.
    const mirror = isFeedbackMirror(msg.rawFromEmail, msg.subject);
    const rows = await spPost<SupportThreadRow>("support_threads", [
      {
        source: "email",
        channel,
        status: mirror ? "ignored" : "new",
        unread: !mirror,
        subject: msg.subject,
        counterpart_email: msg.fromEmail,
        counterpart_name: msg.fromName,
        ...(mirror
          ? {
              triage: {
                is_spam: true,
                classification: "other",
                urgency: "low",
                summary: "Feedback notifier mirror (in-app twin exists)",
                triaged_at: sentAt,
              },
            }
          : {}),
        last_message_at: sentAt,
        last_inbound_at: sentAt,
      },
    ]);
    threadId = rows[0].id;
    isNewThread = true;
  }

  const inserted = await spPost<SupportMessageRow>(
    "support_messages",
    [
      {
        thread_id: threadId,
        direction: "inbound",
        via: "email",
        message_id: msg.messageId,
        in_reply_to: msg.inReplyTo,
        references_ids: refIds,
        from_email: msg.fromEmail,
        // Kept per message: a later reply can carry a fuller name than the
        // one the thread was created with, and names are how we find a
        // Stripe customer who pays from a different address.
        from_name: msg.fromName,
        to_email: msg.toEmail,
        subject: msg.subject,
        body_text: msg.text,
        body_html: msg.html,
        attachments: msg.attachments.length ? msg.attachments : null,
        imap_uid: msg.uid,
        sent_at: sentAt,
      },
    ],
    { onConflict: "message_id", resolution: "ignore" },
  );

  const wasNew = inserted.length > 0;
  if (wasNew && !isNewThread) {
    await patchThread(threadId, inboundThreadPatch(sentAt));
  }
  return wasNew;
}

// ---------------------------------------------------------------------------
// Leg 1b — Dan's replies sent from Gmail
//
// Dan often answers straight from the Gmail app; those messages land in
// [Gmail]/Sent Mail, never INBOX, so without this leg the dashboard thread
// is missing his side of the conversation and keeps prompting for a reply
// that already happened.

async function findThreadByRecipient(email: string): Promise<SupportThreadRow | null> {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await spGet<SupportThreadRow[]>(
    `support_threads?counterpart_email=eq.${encodeURIComponent(email.toLowerCase())}&last_message_at=gte.${encodeURIComponent(cutoff)}&order=last_message_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

async function ingestSent(report: IngestReport): Promise<void> {
  if (!imapConfigured()) return; // inbox leg already reported the miss
  const cursorRow = await getCursor(SENT_CURSOR_ID);
  const { messages, cursor, truncated } = await fetchNewMessages(
    {
      uidvalidity: cursorRow?.uidvalidity ?? null,
      lastUid: cursorRow?.last_uid ?? null,
    },
    "[Gmail]/Sent Mail",
  );
  report.sentFetched = messages.length;

  let firstFailedUid: number | null = null;
  for (const msg of messages) {
    try {
      // Match onto an existing thread only — sent mail never creates one.
      let thread: SupportThreadRow | null = null;
      const threadId = await findThreadByReferences([
        ...(msg.messageId ? [msg.messageId] : []),
        ...msg.references,
        ...(msg.inReplyTo ? [msg.inReplyTo] : []),
      ]);
      if (threadId) {
        const rows = await spGet<SupportThreadRow[]>(
          `support_threads?id=eq.${threadId}&limit=1`,
        );
        thread = rows[0] ?? null;
      } else {
        const recipient = (msg.toEmail ?? "").split(",")[0]?.trim();
        if (recipient && !recipient.endsWith("@dreamme.life")) {
          thread = await findThreadByRecipient(recipient);
        }
      }
      if (!thread) continue; // Dan mailing vendors/others — not support

      const sentAt = msg.date.toISOString();
      const inserted = await spPost<SupportMessageRow>(
        "support_messages",
        [
          {
            thread_id: thread.id,
            direction: "outbound",
            via: "email",
            message_id: msg.messageId,
            in_reply_to: msg.inReplyTo,
            references_ids: [
              ...msg.references,
              ...(msg.inReplyTo ? [msg.inReplyTo] : []),
            ],
            from_email: msg.rawFromEmail ?? "dan@dreamme.life",
            to_email: msg.toEmail,
            subject: msg.subject,
            body_text: msg.text,
            body_html: msg.html,
            imap_uid: msg.uid,
            sent_at: sentAt,
          },
        ],
        { onConflict: "message_id", resolution: "ignore" },
      );
      if (inserted.length === 0) continue; // already stored (dash-sent reply)
      report.sentMatched++;

      // Dan answered → the thread stops asking for a reply, unless the user
      // wrote again AFTER this reply (then it stays 'new'/'drafts_ready').
      const lastInbound = thread.last_inbound_at
        ? new Date(thread.last_inbound_at).getTime()
        : 0;
      if (
        ["new", "drafts_ready"].includes(thread.status) &&
        msg.date.getTime() > lastInbound
      ) {
        await patchThread(thread.id, {
          status: "waiting_user",
          unread: false,
          last_message_at: sentAt,
        });
      }
    } catch (e) {
      if (firstFailedUid === null) firstFailedUid = msg.uid;
      report.legErrors.push(
        `sent uid ${msg.uid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const advanceTo =
    firstFailedUid !== null
      ? Math.min(firstFailedUid - 1, cursor.lastUid)
      : cursor.lastUid;
  const prevUid = cursorRow?.last_uid ?? 0;
  if (advanceTo > prevUid || cursorRow?.uidvalidity !== cursor.uidvalidity) {
    await saveCursor({
      id: SENT_CURSOR_ID,
      uidvalidity: cursor.uidvalidity,
      last_uid: Math.max(advanceTo, 0),
      last_seen_at: null,
    });
  }
  if (truncated) {
    report.legErrors.push("sent: poll cap hit — more mail on next run");
  }
}

// ---------------------------------------------------------------------------
// Leg 2 — in-app feedback

async function ingestFeedback(report: IngestReport): Promise<void> {
  if (!consumerDbConfigured()) {
    report.legErrors.push("feedback: consumer Supabase env not set — skipped");
    return;
  }
  const cursorRow = await getCursor(FEEDBACK_CURSOR_ID);
  const since = cursorRow?.last_seen_at
    ? new Date(new Date(cursorRow.last_seen_at).getTime() - 3600_000) // 1h overlap
    : new Date(Date.now() - FEEDBACK_BOOTSTRAP_DAYS * 86400_000);
  const rows = await fetchFeedbackSince(since.toISOString());
  report.feedbackFetched = rows.length;

  let maxCreated = cursorRow?.last_seen_at ?? since.toISOString();
  for (const fb of rows) {
    try {
      const inserted = await insertFeedbackThread(fb);
      if (inserted) report.feedbackInserted++;
      if (fb.created_at > maxCreated) maxCreated = fb.created_at;
    } catch (e) {
      report.legErrors.push(
        `feedback ${fb.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (maxCreated !== cursorRow?.last_seen_at) {
    await saveCursor({
      id: FEEDBACK_CURSOR_ID,
      uidvalidity: null,
      last_uid: null,
      last_seen_at: maxCreated,
    });
  }
}

async function insertFeedbackThread(fb: ConsumerFeedbackRow): Promise<boolean> {
  const subject = `In-app feedback${fb.category ? `: ${fb.category}` : ""}`;
  const threads = await spPost<SupportThreadRow>(
    "support_threads",
    [
      {
        source: "feedback",
        channel: "in_app",
        status: "new",
        unread: true,
        subject,
        counterpart_email: fb.reply_email?.toLowerCase() ?? null,
        counterpart_name: fb.user_name,
        resolved_app_user_id: fb.user_id,
        feedback_id: fb.id,
        last_message_at: fb.created_at,
        last_inbound_at: fb.created_at,
      },
    ],
    { onConflict: "feedback_id", resolution: "ignore" },
  );
  if (threads.length === 0) return false; // duplicate — already ingested

  await spPost<SupportMessageRow>("support_messages", [
    {
      thread_id: threads[0].id,
      direction: "inbound",
      via: "feedback",
      from_email: fb.reply_email?.toLowerCase() ?? null,
      from_name: fb.user_name,
      subject,
      body_text: fb.message,
      attachments: fb.image_urls?.length
        ? fb.image_urls.map((url) => ({ url }))
        : null,
      sent_at: fb.created_at,
    },
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// Leg 3 — triage

export async function triageOneThread(thread: SupportThreadRow): Promise<void> {
  const messages = await spGet<SupportMessageRow[]>(
    `support_messages?thread_id=eq.${thread.id}&order=sent_at.asc`,
  );
  const firstInbound = messages.find((m) => m.direction === "inbound");
  const fromEmail = thread.counterpart_email ?? firstInbound?.from_email ?? null;

  const userContext = await resolveUser(
    fromEmail,
    thread.resolved_app_user_id,
  ).catch(() => null);

  const { triage, drafts } = await triageThread({
    subject: thread.subject,
    fromEmail,
    fromName: thread.counterpart_name,
    source: thread.source,
    messages,
    userContext,
  });

  if (drafts.length) {
    const existing = await spGet<Pick<SupportDraftRow, "generation">[]>(
      `support_drafts?thread_id=eq.${thread.id}&select=generation&order=generation.desc&limit=1`,
    );
    const generation = (existing[0]?.generation ?? 0) + 1;
    await spPost("support_drafts", drafts.map((body, i) => ({
      thread_id: thread.id,
      generation,
      variant: i + 1,
      body,
      model: triage.model ?? null,
    })));
  }

  const primaryStore = userContext?.subscriptions[0]?.store ?? null;
  await patchThread(thread.id, {
    status: triage.is_spam ? "ignored" : drafts.length ? "drafts_ready" : "new",
    category: triage.classification,
    urgency: triage.urgency,
    triage,
    user_context: userContext,
    resolved_app_user_id: userContext?.appUserId ?? thread.resolved_app_user_id,
    resolved_store: primaryStore,
    ...(triage.is_spam ? { unread: false } : {}),
  });
}

async function triageNewThreads(report: IngestReport): Promise<void> {
  const pending = await spGet<SupportThreadRow[]>(
    `support_threads?status=eq.new&order=last_inbound_at.asc&limit=${MAX_TRIAGE_PER_RUN}`,
  );
  for (const thread of pending) {
    try {
      await triageOneThread(thread);
      report.threadsTriaged++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.triageErrors.push(`${thread.id}: ${msg}`);
      // Leave status 'new'; record the failure for the UI.
      await patchThread(thread.id, {
        triage: { ...(thread.triage ?? {}), error: msg.slice(0, 300) },
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Run serialization
//
// Pub/Sub push made concurrent runs routine (every inbound message is a
// delivery), and two triage legs racing the same 'new' thread would each
// draft it. All entry points — cron, manual Poll now, push — funnel through
// this lock; a push delivery that loses returns 429 so Pub/Sub redelivers
// after the winner finishes.

async function acquireIngestLock(): Promise<boolean> {
  // Ensure the row exists (released state = epoch), then claim it with a
  // conditional PATCH. Postgres serializes the two updates on the row lock,
  // so exactly one concurrent caller sees a matched row.
  await spPost(
    "support_cursors",
    [
      {
        id: LOCK_CURSOR_ID,
        uidvalidity: null,
        last_uid: null,
        last_seen_at: null,
        updated_at: new Date(0).toISOString(),
      },
    ],
    { onConflict: "id", resolution: "ignore" },
  );
  const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const rows = await spPatch<{ id: string }>(
    `support_cursors?id=eq.${LOCK_CURSOR_ID}&updated_at=lt.${encodeURIComponent(cutoff)}`,
    { updated_at: new Date().toISOString() },
  );
  return rows.length > 0;
}

async function releaseIngestLock(): Promise<void> {
  await spPatch(`support_cursors?id=eq.${LOCK_CURSOR_ID}`, {
    updated_at: new Date(0).toISOString(),
  }).catch(() => {}); // a stuck lock self-expires via LOCK_TTL_MS
}

// ---------------------------------------------------------------------------
// Gmail push watch
//
// Gmail expires a watch after ~7 days; whoever lets it lapse silently
// downgrades "seconds" back to "10 minutes" with no error anywhere. So the
// cron run renews it whenever less than a day remains — the 10-minute tick
// doubles as the renewal heartbeat, and the expiration lives in
// support_cursors where the ops queries already look.

async function renewGmailWatch(report: IngestReport): Promise<void> {
  if (!gmailConfigured()) return;
  const row = await getCursor(WATCH_CURSOR_ID);
  const expiresAt = row?.last_seen_at
    ? new Date(row.last_seen_at).getTime()
    : 0;
  if (expiresAt - Date.now() > 24 * 3600_000) return; // still fresh
  const labelName = supportLabel();
  const labelId = labelName ? await labelIdByName(labelName) : null;
  const res = await watchMailbox({
    topicName: pushTopic(),
    labelIds: labelId ? [labelId] : ["INBOX"],
  });
  await saveCursor({
    id: WATCH_CURSOR_ID,
    uidvalidity: null,
    last_uid: null,
    last_seen_at: new Date(Number(res.expiration)).toISOString(),
  });
  report.legErrors.push(
    `watch: renewed Gmail push watch through ${new Date(Number(res.expiration)).toISOString()}`,
  );
}

// ---------------------------------------------------------------------------

function emptyReport(): IngestReport {
  return {
    emailsFetched: 0,
    emailsInserted: 0,
    sentFetched: 0,
    sentMatched: 0,
    feedbackFetched: 0,
    feedbackInserted: 0,
    threadsTriaged: 0,
    namesScanned: 0,
    namesIndexed: 0,
    triageErrors: [],
    legErrors: [],
  };
}

/**
 * Push-triggered run: email leg + triage only. The slow or push-irrelevant
 * legs (IMAP sent matching, in-app feedback, Stripe name index, health)
 * stay on the 10-minute cron — a push delivery is a doorbell for new
 * inbound mail, nothing else.
 *
 * Two-phase on purpose: the route must know synchronously whether the lock
 * was won (a loss becomes 429 so Pub/Sub redelivers), but must NOT wait for
 * the run itself (triage can outlive Pub/Sub's 60s ack window). So this
 * returns null when the lock is busy, else a closure the route hands to
 * waitUntil — which then owns releasing the lock.
 */
export async function beginGmailPushIngest(): Promise<
  (() => Promise<IngestReport>) | null
> {
  if (!(await acquireIngestLock())) return null;
  return async () => {
    const report = emptyReport();
    try {
      try {
        await ingestEmail(report);
      } catch (e) {
        report.legErrors.push(
          `email leg failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      try {
        await triageNewThreads(report);
      } catch (e) {
        report.legErrors.push(
          `triage leg failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } finally {
      await releaseIngestLock();
    }
    return report;
  };
}

export async function runIngest(): Promise<IngestReport> {
  const report = emptyReport();
  if (!(await acquireIngestLock())) {
    report.legErrors.push(
      "another ingest run is already in progress — skipped this one",
    );
    return report;
  }

  try {
    await runIngestLegs(report);
  } finally {
    await releaseIngestLock();
  }
  // Last, and after the legs have had their chance to advance the cursor: a
  // quiet inbox and a broken one look identical from the outside, so check
  // whether mail has actually been moving rather than whether this run errored.
  report.healthAlert = await checkIngestHealth();
  return report;
}

async function runIngestLegs(report: IngestReport): Promise<void> {
  try {
    await ingestEmail(report);
  } catch (e) {
    report.legErrors.push(
      `email leg failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // Sent leg runs BEFORE triage: a thread Dan already answered from Gmail
  // flips to waiting_user and skips the draft generation entirely.
  try {
    await ingestSent(report);
  } catch (e) {
    report.legErrors.push(
      `sent leg failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    await ingestFeedback(report);
  } catch (e) {
    report.legErrors.push(
      `feedback leg failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // Keep the Stripe billing-name index warm so "Maybe this user?" can
  // suggest a match the moment a thread opens. Incremental: a normal pass
  // reads one page.
  try {
    const names = await refreshStripeNameIndex();
    report.namesScanned = names.chargesScanned;
    report.namesIndexed = names.customersUpserted;
  } catch (e) {
    report.legErrors.push(
      `stripe name index failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    await triageNewThreads(report);
  } catch (e) {
    report.legErrors.push(
      `triage leg failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // Keep the Pub/Sub watch alive — see renewGmailWatch for why this rides
  // the cron rather than trusting anyone to remember a weekly chore.
  try {
    await renewGmailWatch(report);
  } catch (e) {
    report.legErrors.push(
      `watch renewal failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
