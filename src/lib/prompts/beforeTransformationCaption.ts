/**
 * Caption prompt for the "before photo" transformation cards in the
 * Content Pipeline. Anchored to Emma's reference caption — every
 * persona reuses its structural beats but rewrites in their own
 * register.
 *
 * Reference (Emma, 28, Florida, Vulnerable Bestie):
 *
 *   this GLP-1 journey definitely tested me at times, but looking
 *   back now… i'd do it all over again!!
 *
 *   190 lbs ➡️ 131 lbs
 *
 *   i feel like a completely different person, not just physically,
 *   but mentally too. more confident, more motivated, and more in
 *   tune with myself than ever before!!
 *
 *   to anyone else on this path, keep showing up for yourself. even
 *   on the hard days, it's worth it. hoping this gives someone the
 *   push they need to start or keep going, you're capable of more
 *   than you think ✨
 *
 * Structural beats every generated caption must hit:
 *   1. Journey acknowledgement — "looking back now" framing.
 *   2. Weight delta — the start → goal numbers on their own line.
 *   3. Identity shift — physical AND mental change.
 *   4. Encouragement — direct address to the reader.
 *
 * The voice + writing style comes from PERSONA_PROFILES, NOT this
 * prompt. The prompt only owns structure + length.
 */

import type { PersonaId } from "@/lib/personas";
import { PERSONA_PROFILES } from "@/lib/persona-profiles";

export const BEFORE_TRANSFORMATION_CHAR_CEILING = 1200;
export const BEFORE_TRANSFORMATION_CHAR_TARGET = 600;

export interface BeforeTransformationOverrides {
  startWeightLbs?: number;
  goalWeightLbs?: number;
  notes?: string;
}

const REFERENCE_CAPTION = `this GLP-1 journey definitely tested me at times, but looking back now… i'd do it all over again!!

190 lbs ➡️ 131 lbs

i feel like a completely different person, not just physically, but mentally too. more confident, more motivated, and more in tune with myself than ever before!!

to anyone else on this path, keep showing up for yourself. even on the hard days, it's worth it. hoping this gives someone the push they need to start or keep going, you're capable of more than you think ✨`;

export function buildBeforeTransformationPrompt(
  personaId: PersonaId,
  overrides: BeforeTransformationOverrides = {},
): string {
  const profile = PERSONA_PROFILES[personaId];
  const startWeight = overrides.startWeightLbs ?? profile.startWeightLbs;
  const goalWeight = overrides.goalWeightLbs ?? profile.goalWeightLbs;

  const parts: string[] = [];

  parts.push(
    `You are writing the Instagram caption for ${profile.name}'s "before transformation" post on DreamMe, a GL🫛-1 community app. ${profile.name} is ${profile.age}, lives in ${profile.location}, archetype: ${profile.archetype}. The caption is reflective — written looking back on the full journey from before-photo to today.`,
  );

  parts.push(
    `PERSONA VOICE:\n${profile.voice}\n\nWRITING STYLE (this is non-negotiable — match it exactly):\n${profile.writingStyle}`,
  );

  if (profile.contentTerritory.length) {
    parts.push(
      `CONTENT LANES SHE OWNS (lean into one or two if it fits naturally; don't list them):\n${profile.contentTerritory
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }

  parts.push(
    `WEIGHT JOURNEY (use these numbers verbatim, on their own line, with the ➡️ unicode arrow):\n${startWeight} lbs ➡️ ${goalWeight} lbs`,
  );

  parts.push(
    `REFERENCE CAPTION (for STRUCTURE only — do NOT copy the wording, voice, or punctuation; ${profile.name} writes very differently):\n---\n${REFERENCE_CAPTION}\n---`,
  );

  parts.push(
    [
      "STRUCTURAL BEATS — hit all four in order:",
      "1. Journey acknowledgement: open with a 'looking back now' framing that fits her voice.",
      "2. Weight delta: the start → goal numbers on their own line (use the ➡️ arrow exactly as shown above).",
      "3. Identity shift: how she changed — physically AND mentally/emotionally. Make it specific to her archetype and life stage.",
      "4. Encouragement: direct address to the reader / community. Closes the caption.",
      "",
      "STRICT RULES:",
      "- Match her writing style exactly — case, punctuation, slang, sentence structure.",
      `- Target ${BEFORE_TRANSFORMATION_CHAR_TARGET} characters. Hard ceiling: ${BEFORE_TRANSFORMATION_CHAR_CEILING} characters.`,
      "- Never use hashtags.",
      "- Never use the syringe emoji — write 'shot' or 'GL🫛-1' instead.",
      "- Write GL🫛-1 (with the pea emoji) instead of GLP-1 to avoid algorithmic suppression.",
      "- Always use contractions (i'm, don't, can't, it's, you're) regardless of casing.",
      "- Do NOT mention DreamMe.",
      "- Do not echo Emma's specific phrases ('definitely tested me', 'completely different person', 'capable of more than you think'). Reach for fresh language in her voice.",
      "- Return ONLY the caption text — no preamble, commentary, fences, or surrounding quotes.",
    ].join("\n"),
  );

  if (overrides.notes && overrides.notes.trim()) {
    parts.push(
      `ADDITIONAL CONTEXT FROM THE EDITOR (weave in if natural):\n${overrides.notes.trim()}`,
    );
  }

  parts.push(`Now write the caption.`);

  return parts.join("\n\n");
}
