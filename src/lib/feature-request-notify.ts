/**
 * Feature Requests → email the dev a link whenever a ticket is created
 * (Create ticket in the Support Inbox, the tab's Add request button, or the
 * ingest API). The link opens the ticket in the dash; the Feature Requests
 * tab is admin-only, so the reader still needs the admin password.
 *
 * The body carries the brief (what they want, what it needs) but nothing
 * that identifies the customer: no name, email, plan or quote. That stays
 * behind the dash login, because this goes to a personal inbox.
 *
 * Sending never blocks or fails ticket creation; callers report the error.
 */
import { sendTeamNotice } from "@/lib/support/mailer";
import type { FeatureRequestDetails } from "@/lib/types";

/** Override with FEATURE_REQUEST_NOTIFY_TO (comma-separated; empty = off). */
const DEFAULT_RECIPIENTS = ["dvnguyennn@gmail.com"];

export function notifyRecipients(
  env: string | undefined = process.env.FEATURE_REQUEST_NOTIFY_TO,
): string[] {
  if (env === undefined) return DEFAULT_RECIPIENTS;
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function featureRequestUrl(origin: string, id: string): string {
  return `${origin}/?tab=requests&request=${encodeURIComponent(id)}`;
}

const KIND_LABELS: Record<string, string> = {
  feature: "New feature",
  improvement: "Improvement",
  bug: "Bug",
  content: "Content",
};

export function buildFeatureRequestEmail(params: {
  id: string;
  title: string;
  details: FeatureRequestDetails | null;
  origin: string;
}): { subject: string; bodyText: string } {
  const brief = params.details?.brief ?? null;
  const url = featureRequestUrl(params.origin, params.id);
  const prefix = brief?.kind === "bug" ? "New bug report" : "New feature request";
  // Inbox-filed titles open with the customer's name and plan ("Jamie
  // (about_to_start, paid monthly) requests…"), so the brief's ask is the
  // headline whenever there is one.
  const headline = brief?.ask ?? params.title;

  const lines: string[] = [headline, ""];
  if (brief) {
    lines.push(
      `${KIND_LABELS[brief.kind] ?? brief.kind} · ${brief.area} · ${brief.effort} effort`,
    );
    if (brief.why) lines.push(`Why: ${brief.why}`);
    if (brief.needs.length) {
      lines.push("", "What it needs:", ...brief.needs.map((n) => `- ${n}`));
    }
    if (brief.openQuestions.length) {
      lines.push("", "Open questions:", ...brief.openQuestions.map((q) => `- ${q}`));
    }
    lines.push("");
  }
  lines.push(
    `Open the ticket: ${url}`,
    "(Feature Requests is admin-only, so sign in with the admin password.)",
  );

  return {
    subject: `${prefix}: ${headline.slice(0, 120)}`,
    bodyText: lines.join("\n"),
  };
}

/** Send the notice; returns an error string instead of throwing. */
export async function notifyFeatureRequestCreated(params: {
  id: string;
  title: string;
  details: FeatureRequestDetails | null;
  origin: string;
}): Promise<string | null> {
  const to = notifyRecipients();
  if (to.length === 0) return null;
  try {
    await sendTeamNotice({ to, ...buildFeatureRequestEmail(params) });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
