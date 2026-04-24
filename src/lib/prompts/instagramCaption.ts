/**
 * Instagram caption prompt scaffolding.
 *
 * Instagram captions are a sibling to the TikTok caption generator — same
 * hook as the seed, but a distinct voice and a hard 2000-character ceiling.
 * Where TikTok captions pack 7-10 numbered tips with ✅ + 👉 formatting,
 * IG captions lean into storytelling paragraphs and let the hook breathe.
 *
 * Decisions baked in here:
 *   - No hashtags. The creator adds them manually if they want any.
 *   - No emoji-heavy formatting. Light emoji is fine, but this isn't the
 *     TikTok tip-list style.
 *   - Hard ceiling 2000 chars; target ~1800 to leave compress headroom.
 *   - Persona voice comes from the existing tagline in personas.ts. Richer
 *     per-persona voice guides can be added later.
 */

import type { PersonaId } from "@/lib/personas";
import { PERSONAS } from "@/lib/personas";

export const INSTAGRAM_CHAR_CEILING = 2000;
export const INSTAGRAM_CHAR_TARGET = 1800;

function voiceAnchor(personaId: PersonaId): string {
  const p = PERSONAS[personaId];
  return `${p.name} — ${p.tagline}`;
}

/**
 * Build the full system + user prompt body for a single IG caption
 * generation. The caller wraps this into a Claude messages call.
 */
export function buildInstagramCaptionPrompt(
  hookText: string,
  personaId: PersonaId,
  notes?: string,
): string {
  const voice = voiceAnchor(personaId);
  const parts: string[] = [];

  parts.push(
    `You are writing an Instagram caption for DreamMe, a GLP-1 community app. Write in the voice of ${voice}. This caption is a sibling to a TikTok caption generated from the same hook — treat them as parallel siblings, not translations. The reader is scrolling Instagram, not TikTok; adjust the tempo accordingly.`,
  );

  parts.push(
    `SEED HOOK (use this as the emotional anchor; do NOT repeat it verbatim as the first line):\n${hookText.trim()}`,
  );

  if (notes && notes.trim()) {
    parts.push(`ADDITIONAL CONTEXT FROM THE EDITOR:\n${notes.trim()}`);
  }

  parts.push(
    [
      "INSTAGRAM STYLE RULES:",
      "- Open with a single evocative line or a short first-person beat that pulls the reader in.",
      "- Use 2–4 short paragraphs. Line breaks are encouraged; whitespace is breathing room on IG.",
      "- First-person, conversational, honest. No listicle / tip-stack formatting. No numbered tips. No ✅ or 👉 markers.",
      "- Light emoji only if it genuinely fits the voice. Do not stack emoji at the end of lines.",
      "- Mention DreamMe naturally at most once — as part of the story, not as an ad.",
      "- End with one soft invitation to engage (a question, a shared feeling, or a resonant one-liner). No hard CTA, no \"save this for later,\" no 👇.",
      "",
      "HARD CONSTRAINTS:",
      `- HARD CEILING: ${INSTAGRAM_CHAR_CEILING} characters. Target around ${INSTAGRAM_CHAR_TARGET}.`,
      "- Do NOT include hashtags. Not at the end, not inline, not hidden in a trailing block. The creator adds their own.",
      "- Do NOT include any preamble (\"Here's a caption:\" etc.), commentary, or markdown code fences. Return only the caption text.",
      "- Do NOT wrap the caption in quotation marks.",
    ].join("\n"),
  );

  parts.push(
    `Now write the Instagram caption for the hook above, in ${voice}'s voice, under ${INSTAGRAM_CHAR_CEILING} characters, no hashtags.`,
  );

  return parts.join("\n\n");
}

/**
 * Build the compress retry prompt. Called when the first generation comes
 * back over the hard ceiling.
 */
export function buildInstagramCompressPrompt(
  oversizedCaption: string,
  personaId: PersonaId,
): string {
  const voice = voiceAnchor(personaId);
  return [
    `You are rewriting an Instagram caption for DreamMe in the voice of ${voice}.`,
    "",
    `The caption below is over the ${INSTAGRAM_CHAR_CEILING}-character hard ceiling (${oversizedCaption.length} chars). Rewrite it to fit UNDER ${INSTAGRAM_CHAR_TARGET} characters while preserving:`,
    "- The emotional beat of the opening line",
    "- The voice and conversational rhythm",
    "- Any DreamMe mention (once, natural)",
    "- The soft closing invitation to engage",
    "",
    "Trim by shortening sentences and cutting secondary beats, not by collapsing the structure into a single paragraph. Keep paragraph breaks where they add breathing room.",
    "",
    "DO NOT add hashtags. DO NOT add a preamble. Return only the rewritten caption.",
    "",
    "CURRENT OVERSIZED CAPTION:",
    oversizedCaption,
  ].join("\n");
}

/**
 * Strip a trailing hashtag block if Claude slips and appends one despite
 * the instruction. Belt-and-suspenders post-processing.
 *
 * Matches a run of hashtag tokens (optionally separated by whitespace) at
 * the very end of the caption. Does not touch inline `#foo` mid-sentence
 * unless it's part of the final run — if the caption ends with "#tag1 #tag2"
 * those get stripped.
 */
export function stripTrailingHashtags(caption: string): string {
  // Walk from the end, strip trailing whitespace + any #token clusters.
  let out = caption.replace(/\s+$/, "");
  // Pattern: optional line-break + one or more #tokens separated by spaces/newlines.
  const tail = /(?:\s*#[^\s#]+)+\s*$/;
  while (tail.test(out)) {
    out = out.replace(tail, "").replace(/\s+$/, "");
  }
  return out;
}
