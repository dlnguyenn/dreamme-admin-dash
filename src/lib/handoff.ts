/**
 * Hand off a Roadmap card or Feature Requests ticket to #handoffs in Discord.
 * Builds the post from the saved record; the Supabase `handoff` function does
 * the posting. Tickets leave out the requester, their words and screenshots:
 * those stay on the DAD, and the post links back to them.
 */
import { STAGE_LABELS, type RoadmapItem } from "@/lib/roadmap";
import type { FeatureRequestRow } from "@/lib/types";

export const HANDOFF_URL =
  "https://itutqvowpmsrvosilios.supabase.co/functions/v1/handoff/handoffs";

export interface HandoffDraft {
  title: string;
  summary: string;
  context: string;
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
const section = (heading: string, body: string | null | undefined) =>
  body?.trim() ? `## ${heading}\n${body.trim()}` : null;
const join = (parts: Array<string | null>) => parts.filter(Boolean).join("\n\n") + "\n";

export function roadmapHandoff(item: RoadmapItem, origin: string): HandoffDraft {
  const facts = [
    `Stage: ${STAGE_LABELS[item.stage]}`,
    `Priority: ${item.priority}`,
    item.owner ? `Owner: ${item.owner}` : null,
    item.area ? `Area: ${item.area}` : null,
    item.target_date ? `Target date: ${item.target_date}` : null,
  ].filter(Boolean) as string[];
  return {
    title: item.title,
    summary: `Roadmap card: ${item.title}\n${facts.join(" · ")}`,
    context: join([
      `# ${item.title}`,
      bullets(facts),
      section("Notes", item.notes),
      section("Brief", item.brief_url),
      item.feature_request_id
        ? section("Feature request", `${origin}/?tab=requests&request=${encodeURIComponent(item.feature_request_id)}`)
        : null,
      section("On the DAD", `${origin}/?tab=roadmap`),
    ]),
  };
}

export function requestHandoff(row: FeatureRequestRow, origin: string): HandoffDraft {
  const brief = row.details?.brief ?? null;
  const facts = [
    `Status: ${row.status}`,
    brief ? `Kind: ${brief.kind}` : null,
    row.epic ?? brief?.area ? `Area: ${row.epic ?? brief?.area}` : null,
    brief ? `Effort: ${brief.effort}` : null,
  ].filter(Boolean) as string[];
  // Ticket titles can name the requester ("Pat reports..."), so the brief's ask goes first.
  const title = brief?.ask || row.title;
  return {
    title,
    summary: `Feature request: ${title}\n${facts.join(" · ")}`,
    context: join([
      `# ${title}`,
      bullets(facts),
      section("Why", brief?.why),
      brief?.needs.length ? section("What it needs", bullets(brief.needs)) : null,
      brief?.openQuestions.length ? section("Open questions", bullets(brief.openQuestions)) : null,
      // Written by hand or copied from the user, so it's only used when there's no brief.
      brief ? null : section("Description", row.description),
      section(
        "On the DAD (requester and their full message)",
        `${origin}/?tab=requests&request=${encodeURIComponent(row.id)}`,
      ),
    ]),
  };
}

const SECRET =
  /(sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_|EAA[A-Za-z0-9]{40,}|eyJhbGciOi[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|sbp_[a-z0-9]{20,}|xox[bp]-|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;

/** Same check as handoff.js: posts land in Discord, so refuse anything that looks like a credential. */
export function looksLikeSecret(draft: HandoffDraft): boolean {
  return SECRET.test(`${draft.title}\n${draft.summary}\n${draft.context}`);
}
