/**
 * Support Inbox → ticket content, for both destinations: a Trello card and
 * a row in the dash's own feature_requests table (the Feature Requests tab).
 * Pure and unit-tested — the HTTP lives in vendors/trello.ts and the insert
 * in support/db.ts, so everything that decides what the ticket SAYS can be
 * exercised without a token.
 *
 * A ticket has to stand on its own weeks later, when the thread is cold, so
 * it carries the sender's email (the follow-up handle), their unedited words
 * (not a paraphrase — the phrasing is the feature request), and a link back
 * to the conversation.
 */
import type { SupportThreadRow } from "./types";
import { splitQuotedText } from "./email-text";

/** Trello accepts 16k, but a card that long is unreadable on a board. */
const MAX_BODY = 4000;
const MAX_TITLE = 100;

export interface TrelloCardInput {
  thread: SupportThreadRow;
  /** best available plain text of the first inbound message */
  inboundBody: string | null;
  /** absolute deep link back into the Support Inbox */
  threadUrl: string;
  /** when the request came in; passed in to keep this pure */
  receivedAt?: string | null;
}

export interface TrelloCardContent {
  name: string;
  desc: string;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "Lilia A. Mijares <lamija@x.com>", or whichever half we have. */
export function senderLabel(thread: SupportThreadRow): string {
  const name = thread.user_context?.name?.trim() || thread.counterpart_name?.trim();
  const email = thread.counterpart_email?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || "unknown sender";
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Card title: the triage one-liner is what makes a board scannable, so it
 * wins. Subject is the fallback, and a bare email address beats an empty
 * card name (Trello rejects those).
 */
export function cardTitle(thread: SupportThreadRow): string {
  const summary = thread.triage?.summary?.trim();
  if (summary) return truncate(summary, MAX_TITLE);
  const subject = thread.subject?.trim();
  if (subject) return truncate(subject, MAX_TITLE);
  const email = thread.counterpart_email?.trim();
  return truncate(
    email ? `Support request from ${email}` : "Support request",
    MAX_TITLE,
  );
}

export function buildTrelloCard(input: TrelloCardInput): TrelloCardContent {
  const { thread, inboundBody, threadUrl } = input;

  // Only the author's words — a quoted reply chain would bury the ask.
  const { main } = splitQuotedText(inboundBody ?? "");
  const quotedBody = truncate(main, MAX_BODY);

  const meta = [
    `**Category:** ${thread.category ?? "uncategorized"}`,
    `**Urgency:** ${thread.urgency ?? "normal"}`,
  ];
  const received = formatDate(input.receivedAt ?? thread.last_inbound_at);
  if (received) meta.push(`**Received:** ${received}`);

  const parts = [`**From:** ${senderLabel(thread)}`, meta.join(" · ")];

  if (quotedBody) {
    // Blockquote every line so multi-paragraph asks stay visually theirs.
    parts.push(
      quotedBody
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n"),
    );
  }

  parts.push("---", `[Open in Support Inbox](${threadUrl})`);

  return { name: cardTitle(thread), desc: parts.join("\n\n") };
}

export interface FeatureRequestInsert {
  title: string;
  description: string;
  submitter_email: string | null;
  status: "new";
}

/**
 * The same ticket as a Feature Requests row. The table has a dedicated
 * submitter_email column, so the email comes out of the prose and into the
 * field the tab actually filters and displays on.
 */
export function buildFeatureRequest(
  input: TrelloCardInput & { cardUrl?: string | null },
): FeatureRequestInsert {
  const { thread, inboundBody, threadUrl } = input;
  const { main } = splitQuotedText(inboundBody ?? "");
  const body = truncate(main, MAX_BODY);

  const parts: string[] = [];
  if (body) parts.push(body);
  const links = [`Support thread: ${threadUrl}`];
  if (input.cardUrl) links.push(`Trello: ${input.cardUrl}`);
  parts.push(links.join("\n"));

  return {
    title: cardTitle(thread),
    description: parts.join("\n\n"),
    submitter_email: thread.counterpart_email?.trim() || null,
    status: "new",
  };
}
