/**
 * Feature Requests: everything a ticket carries beyond title + description,
 * so the tab answers "what does this need?" at a glance instead of pointing
 * at Trello. Built when a support thread is filed (Create ticket) and on
 * Regenerate for older rows.
 *
 * The deterministic parts (who asked, their words, screenshots, links) are
 * pure and unit-tested. The brief is one Claude call; if it fails the ticket
 * is still filed without one, because a missing brief can be regenerated
 * while a failed filing loses the request.
 */
import { callClaude, firstJson, anthropicConfigured } from "@/lib/anthropic";
import type {
  FeatureRequestBrief,
  FeatureRequestDetails,
  FeatureRequestRequester,
} from "@/lib/types";
import { splitQuotedText } from "./email-text";
import type { SubscriptionInfo, SupportMessageRow, SupportThreadRow } from "./types";

const MODEL = "claude-sonnet-4-6";
const MAX_QUOTE = 4000;

const KINDS: FeatureRequestBrief["kind"][] = ["feature", "improvement", "bug", "content"];
const EFFORTS: FeatureRequestBrief["effort"][] = ["small", "medium", "large"];

/** Areas the brief picks from, so the epic filter stays a short list. */
export const APP_AREAS = [
  "Medication & shots",
  "Food logging",
  "Nutrition targets",
  "Weight & body",
  "Activity",
  "Health integrations",
  "AI chat",
  "Community",
  "Fish companion",
  "Widgets",
  "Reports & sharing",
  "Onboarding",
  "Subscription & billing",
  "Settings & account",
  "Other",
];

// ---------------------------------------------------------------------------
// Deterministic parts

/** The subscription that best describes the person today. */
function primarySubscription(subs: SubscriptionInfo[]): SubscriptionInfo | null {
  if (subs.length === 0) return null;
  const active = subs.filter((s) => s.isActive);
  const pool = active.length ? active : subs;
  return pool.reduce((a, b) => (a.lastEventAt >= b.lastEventAt ? a : b));
}

export function planLabel(sub: SubscriptionInfo | null): string {
  if (!sub) return "No subscription";
  const plan = sub.plan ?? "plan";
  const base = sub.isTrial ? `Trial (${plan})` : `Paid ${plan}`;
  return sub.isActive ? base : `${base}, lapsed`;
}

export function requesterSnapshot(
  thread: SupportThreadRow,
): FeatureRequestRequester {
  const ctx = thread.user_context;
  const sub = ctx ? primarySubscription(ctx.subscriptions) : null;
  return {
    name: ctx?.name?.trim() || thread.counterpart_name?.trim() || null,
    email: thread.counterpart_email?.trim() || ctx?.email || null,
    plan: ctx ? planLabel(sub) : null,
    store: sub ? String(sub.store) : null,
    active: sub ? sub.isActive : null,
    totalPaidUsd: ctx ? ctx.totalSpentUsd : null,
    memberSince: ctx?.accountCreatedAt ?? sub?.startedAt ?? null,
    journeyStage: ctx?.journeyStage ?? null,
  };
}

/** In-app feedback screenshots live on the inbound messages' attachments. */
export function screenshotUrls(messages: SupportMessageRow[]): string[] {
  const urls: string[] = [];
  for (const m of messages) {
    if (m.direction !== "inbound") continue;
    for (const a of m.attachments ?? []) {
      if (a.url && !urls.includes(a.url)) urls.push(a.url);
    }
  }
  return urls;
}

export function quoteFrom(inboundBody: string | null): string | null {
  const { main } = splitQuotedText(inboundBody ?? "");
  const t = main.trim();
  if (!t) return null;
  return t.length <= MAX_QUOTE ? t : `${t.slice(0, MAX_QUOTE - 1).trimEnd()}…`;
}

/** Older rows only link their thread inside the description text. */
export function threadIdFromText(text: string | null | undefined): string | null {
  const m = (text ?? "").match(
    /[?&]thread=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m ? m[1] : null;
}

export function trelloUrlFromText(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/https:\/\/trello\.com\/c\/[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// The brief

const SYSTEM = `You turn a DreamMe user's feature request or bug report into a short ticket brief for the founders and their developer.

DreamMe is a GLP-1 weight-loss companion app (iOS + Android, subscription). It has: medication and shot tracking for 11 supported GLP-1 medications, dose reminders and side-effect logging; food logging (search, barcode/photo scan) with a GLP-1 nutrition score and protein/fiber targets; weight and body tracking; activity logging; Apple Health and Health Connect sync; an AI chat; a community feed with posts and comments; Sushi, a pet fish companion with moods, accessories and a shop; home-screen widgets; and a doctor report.

Write for someone deciding whether and how to build it. Be concrete and brief. Do not invent facts about the user or about how the app works today; if something is unclear, put it in open_questions. Never use em dashes or en dashes.

Output STRICTLY JSON:
{"kind": "feature"|"improvement"|"bug"|"content", "area": one of ${JSON.stringify(APP_AREAS)}, "ask": string, "why": string, "needs": string[], "open_questions": string[], "effort": "small"|"medium"|"large"}

- kind: "bug" when something that should already work is broken, "improvement" for a change to something that exists, "feature" for a new capability, "content" for new items in an existing list (an activity, a food, a medication, an accessory).
- ask: one sentence, what they want, starting with a verb.
- why: one or two sentences on the problem behind it, in terms of the user's goal.
- needs: 2 to 5 short bullets of the work it would take (screens, data, logic, integrations). For a bug, what to investigate and fix.
- open_questions: 0 to 3 short questions worth settling first.
- effort: rough size for a small team.`;

export function buildBriefInput(params: {
  title: string;
  quote: string | null;
  requester: FeatureRequestRequester | null;
  notes?: string | null;
}): string {
  const r = params.requester;
  const who = r
    ? [
        r.plan && `plan: ${r.plan}`,
        r.store && `store: ${r.store}`,
        r.journeyStage && `GLP-1 stage: ${r.journeyStage}`,
        r.memberSince && `member since ${r.memberSince.slice(0, 10)}`,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return [
    `TICKET TITLE: ${params.title}`,
    who && `REQUESTER: ${who}`,
    params.quote ? `USER'S OWN WORDS:\n${params.quote}` : "",
    params.notes ? `NOTES ON THE TICKET:\n${params.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const DASHES = /\s*[–—]\s*/g;

function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(DASHES, ", ").trim().slice(0, max);
}

function cleanList(v: unknown, maxItems: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => cleanText(x, 240))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Validate the model's JSON; anything malformed falls back, never throws. */
export function parseBrief(
  raw: unknown,
  at: string = new Date().toISOString(),
): FeatureRequestBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ask = cleanText(o.ask, 300);
  if (!ask) return null;
  const kind = KINDS.includes(o.kind as FeatureRequestBrief["kind"])
    ? (o.kind as FeatureRequestBrief["kind"])
    : "feature";
  const effort = EFFORTS.includes(o.effort as FeatureRequestBrief["effort"])
    ? (o.effort as FeatureRequestBrief["effort"])
    : "medium";
  const area = APP_AREAS.includes(o.area as string) ? (o.area as string) : "Other";
  return {
    kind,
    area,
    ask,
    why: cleanText(o.why, 500),
    needs: cleanList(o.needs, 5),
    openQuestions: cleanList(o.open_questions, 3),
    effort,
    model: MODEL,
    generatedAt: at,
  };
}

export async function generateBrief(params: {
  title: string;
  quote: string | null;
  requester: FeatureRequestRequester | null;
  notes?: string | null;
}): Promise<FeatureRequestBrief | null> {
  if (!anthropicConfigured()) return null;
  const text = await callClaude({
    model: MODEL,
    system: SYSTEM,
    content: [{ type: "text", text: buildBriefInput(params) }],
    maxTokens: 800,
    maxRetries: 2,
  });
  return parseBrief(firstJson(text));
}

/** Brief as Trello markdown, placed above the user's quote on the card. */
export function briefMarkdown(brief: FeatureRequestBrief): string {
  const lines = [
    `**${brief.kind[0].toUpperCase()}${brief.kind.slice(1)}** · ${brief.area} · ${brief.effort} effort`,
    `**Ask:** ${brief.ask}`,
  ];
  if (brief.why) lines.push(`**Why:** ${brief.why}`);
  if (brief.needs.length) {
    lines.push(`**What it needs:**\n${brief.needs.map((n) => `- ${n}`).join("\n")}`);
  }
  if (brief.openQuestions.length) {
    lines.push(
      `**Open questions:**\n${brief.openQuestions.map((q) => `- ${q}`).join("\n")}`,
    );
  }
  return lines.join("\n\n");
}

/** Run the brief, but never let it block filing the ticket. */
export async function safeGenerateBrief(
  params: Parameters<typeof generateBrief>[0],
): Promise<{ brief: FeatureRequestBrief | null; error: string | null }> {
  try {
    return { brief: await generateBrief(params), error: null };
  } catch (e) {
    return { brief: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function ticketDetails(params: {
  thread: SupportThreadRow | null;
  messages: SupportMessageRow[];
  quote: string | null;
  brief: FeatureRequestBrief | null;
  threadUrl: string | null;
  trelloUrl: string | null;
  receivedAt: string | null;
}): FeatureRequestDetails {
  const { thread } = params;
  return {
    brief: params.brief,
    requester: thread ? requesterSnapshot(thread) : null,
    quote: params.quote,
    screenshots: screenshotUrls(params.messages),
    source: thread ? (thread.source === "feedback" ? "feedback" : "email") : "manual",
    receivedAt: params.receivedAt,
    threadUrl: params.threadUrl,
    trelloUrl: params.trelloUrl,
  };
}
