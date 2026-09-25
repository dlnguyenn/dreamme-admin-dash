/**
 * Ad breakdown · the two Gemini passes and the Claude verdict. The listen
 * pass is the ears (scenes, transcript, music, claims); the pre-flight pass
 * grades the ad against Motion's rubric with forced yes/no anchors; the
 * verdict turns the evidence into the five-part write-up the local skill
 * produces. Mirrors ~/.claude/skills/ad-breakdown.
 */
import { CRITERION_KEYS, PREFLIGHT_CRITERIA, type Pacing, type TranscriptSegment } from "./rubric";
import { MOTION_RUBRIC } from "./motion-rubric";
import type { AdDetails } from "./meta";

const PRODUCT =
  "DreamMe is a GLP-1 companion app: food, protein, water and dose logging with a virtual pet fish named Sushi.";

export const LISTEN_SCHEMA = {
  type: "object",
  properties: {
    duration_s: { type: "number", description: "Total length of the video in seconds" },
    hook_first_3s: { type: "string", description: "What happens visually and audibly in seconds 0-3; quote on-screen text verbatim" },
    hook_score_1_5: { type: "integer" },
    hook_reasoning: { type: "string" },
    has_speech: { type: "boolean", description: "Any spoken words at all, on camera or voiceover" },
    speech_type: { type: "string", description: "one of: on-camera, voiceover, both, none" },
    speech_delivery: { type: "string", description: "Tone, pace, energy, who is speaking; empty if none" },
    music: {
      type: "object",
      properties: {
        present: { type: "boolean" },
        genre_mood: { type: "string" },
        energy_1_5: { type: "integer" },
        sync_with_cuts: { type: "string" },
      },
      required: ["present", "genre_mood", "energy_1_5"],
    },
    captions_style: { type: "string", description: "Burned-in caption style, size, placement; empty if none" },
    scenes: {
      type: "array",
      maxItems: 14,
      description: "One entry per shot or clear visual idea; entries tile the video",
      items: {
        type: "object",
        properties: {
          start_s: { type: "number" },
          end_s: { type: "number" },
          visual: { type: "string" },
          on_screen_text: { type: "string", description: "Verbatim, never paraphrased; empty if none" },
          audio: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["start_s", "end_s", "visual", "on_screen_text", "audio", "purpose"],
      },
    },
    transcript: {
      type: "array",
      maxItems: 40,
      description: "Every spoken word, verbatim, as timestamped segments of at most 8 seconds; empty if nothing is spoken",
      items: {
        type: "object",
        properties: { start_s: { type: "number" }, end_s: { type: "number" }, text: { type: "string" } },
        required: ["start_s", "end_s", "text"],
      },
    },
    app_first_shown_s: { type: "number", description: "Second the DreamMe app UI, name or fish first appears; -1 if never" },
    cta: { type: "string" },
    claims_or_compliance_flags: { type: "array", maxItems: 6, items: { type: "string" } },
    weaknesses: { type: "array", maxItems: 5, items: { type: "string" } },
    testable_improvements: { type: "array", maxItems: 5, items: { type: "string" } },
  },
  required: [
    "duration_s",
    "hook_first_3s",
    "hook_score_1_5",
    "hook_reasoning",
    "has_speech",
    "speech_type",
    "music",
    "scenes",
    "transcript",
    "app_first_shown_s",
    "cta",
    "claims_or_compliance_flags",
    "weaknesses",
    "testable_improvements",
  ],
};

function adMetaLine(det: AdDetails | null, dur: number | null): string {
  let s = dur ? `Duration ${dur.toFixed(1)}s. ` : "";
  if (det) {
    s += `Ad name: ${det.name}. Primary text: ${det.primary_text ?? ""}. Headline: ${det.headline ?? ""}. `;
  }
  return s;
}

export function listenPrompt(det: AdDetails | null, dur: number | null): string {
  return (
    `You are a direct-response video ad analyst for DreamMe. ${PRODUCT} Watch AND listen to this vertical Meta ad. ` +
    adMetaLine(det, dur) +
    "Return ONLY the JSON. Be concise: every string under 200 characters, at most 14 scenes, quote on-screen " +
    "text verbatim, timestamps in seconds. The transcript must be every spoken word in order, split into " +
    "segments of at most 8 seconds with accurate start and end times."
  );
}

export const PREFLIGHT_SCHEMA = {
  type: "object",
  properties: {
    hook_tactic_primary: {
      type: "string",
      description:
        "newness, offer, urgency, fomo, confession, exclusivity, curiosity, bold claim, shocking statement, if-then, warning, contrarian, relatability, contrast, direct address, authority, storytelling, question, how-to, listicle, explainer, pov, other",
    },
    hook_tactic_secondary: { type: "string" },
    thumbstop_type: { type: "string", description: "human connection, bold problem statement, shocking or satisfying visual, or none" },
    visual_format: {
      type: "string",
      description:
        "Motion's format name: demo, testimonial, montage, listicle, us vs them, unboxing, founder, pov, screen recording, problem agitation, how-to, expert explainer, before and after, greenscreen, ugc overlay, feature benefit pointout, stitch, reaction video, transformation, headline, offer-first banner, other",
    },
    asset_type: { type: "string", description: "ugc, ugc mashup, high production, screen recording, animation, text only, hybrid" },
    awareness_stage: { type: "string", description: "unaware, problem-aware, solution-aware, product-aware, most-aware" },
    persona_pain: { type: "string", description: "the persona x pain this ad speaks to, one line" },
    scores: {
      type: "object",
      properties: Object.fromEntries(
        CRITERION_KEYS.map((k) => [
          k,
          {
            type: "object",
            description: PREFLIGHT_CRITERIA[k],
            properties: {
              anchor_2_met: {
                type: "boolean",
                description: "true only if the anchor for a score of 2 (or 1 for x_factor) is fully met",
              },
              anchor_0_met: { type: "boolean", description: "true only if the anchor for a score of 0 applies" },
              evidence: { type: "string", description: "timestamp plus what is seen or heard" },
            },
            required: ["anchor_2_met", "anchor_0_met", "evidence"],
          },
        ]),
      ),
      required: CRITERION_KEYS,
    },
    missing_from_formula: { type: "array", maxItems: 6, items: { type: "string" } },
    predicted_hook_band: {
      type: "string",
      enum: ["needs work", "solid", "strong"],
      description: "under 25%, 25 to 35%, over 35% of impressions reaching 3 s",
    },
    predicted_hold_band: {
      type: "string",
      enum: ["weak", "average", "strong"],
      description: "under 30%, 30 to 60%, over 60% of 3 s viewers reaching ThruPlay",
    },
    predicted_leak: { type: "string", description: "where viewers will most likely leave and why, with a timestamp" },
    prediction_reasoning: { type: "string" },
    hook_alternatives: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { tactic: { type: "string" }, on_screen_text: { type: "string" }, spoken: { type: "string" } },
        required: ["tactic", "on_screen_text", "spoken"],
      },
    },
  },
  required: [
    "hook_tactic_primary",
    "hook_tactic_secondary",
    "thumbstop_type",
    "visual_format",
    "asset_type",
    "awareness_stage",
    "persona_pain",
    "scores",
    "missing_from_formula",
    "predicted_hook_band",
    "predicted_hold_band",
    "predicted_leak",
    "prediction_reasoning",
    "hook_alternatives",
  ],
};

export function preflightPrompt(
  det: AdDetails | null,
  dur: number | null,
  pacing: Pacing,
  transcript: TranscriptSegment[],
): string {
  const spoken = transcript.map((s) => s.text).join(" ").trim() || "(no speech)";
  return (
    `You are grading a vertical Meta ad for DreamMe against Motion's winning-ad rubric. ${PRODUCT} ` +
    adMetaLine(det, dur) +
    `Cut pacing (${pacing.source}): ${pacing.cuts} cuts, median gap ${pacing.median_gap_s}s, longest static ` +
    `stretch ${pacing.longest_static_s}s, ${pacing.cuts_first_3s} cuts in the first 3 s. ` +
    `Transcript: ${spoken.slice(0, 1500)}\n\n=== RUBRIC ===\n${MOTION_RUBRIC}\n\n=== YOUR TASK ===\n` +
    "For every criterion answer two yes/no questions from its description: is the anchor for 2 fully met " +
    "(anchor_2_met), and does the anchor for 0 apply (anchor_0_met)? Both false means partial. Watch the " +
    "video before answering and put a timestamp in each evidence line. Classify the hook tactic, thumbstop " +
    "type, format, asset type and awareness stage with the rubric's names. Predict the hook and hold bands " +
    "against the rubric's benchmarks and the account priors; Motion's data says about 5% of ads win, so do " +
    "not inflate. Propose 3 alternative hooks using higher-hit-rate tactics that fit this product: " +
    "on_screen_text at most 8 words, spoken a different conversational line, no medication brand names, no " +
    "unsubstantiated weight-loss claims. Return ONLY the JSON, every string under 200 characters."
  );
}

// ── the written verdict (Claude) ────────────────────────────────────────────

export const VERDICT_SYSTEM = `You write the verdict on a DreamMe video ad from structured evidence. ${PRODUCT}
Rules:
- Meta's numbers are the truth. Gemini's scores are opinions; never lead with them. Frames, transcript and scene descriptions are the evidence you cite, with seconds.
- Hook rate = 3-second plays / impressions (Motion: under 25% needs work, 25 to 35% solid, over 35% strong). Hold = ThruPlay / 3-second plays (under 30% weak, 40 to 50% average, over 60% strong).
- Motion's diagnosis: hook low means fix the first 3 s; hook strong and hold weak means the body does not deliver the hook's promise; attention fine and conversion poor means offer, CTA or landing; CTR high and conversion poor means clickbait or wrong audience.
- Listicles dominate DreamMe's organic TikTok, but on paid Meta Motion ranks listicle, question, how-to and explainer hooks at the bottom by hit rate; do not carry the organic playbook into paid verdicts unthinkingly.
- Nobody predicts winners (about 5% of ads win). A pre-flight says what is missing and where it will leak, never that it will win.
- Cite moments as seconds with one decimal, like "at 7.5 s" or "0 to 3 s", never mm:ss.
- No em dashes anywhere. Use periods, commas or colons. Plain markdown, headings as bold lines, at most 320 words.
Format for an AIRED ad: **Numbers** · **Hook (0-3 s)** · **Where they leave** · **What is working** · **What to test** (2-3 edits tied to seconds; compliance flags separately).
Format for an UNAIRED ad: **Formula check** (score, missing elements with timestamps, tactic/format/stage with Motion's hit rate) · **Predicted bands and likely leak** (bands, never numbers) · **Ship, fix first, or reshoot** (one call, exact edits with timestamps) · **Hook variations to shoot** · **Compliance**.`;

export function verdictUser(evidence: unknown): string {
  return `Evidence JSON:\n${JSON.stringify(evidence)}`;
}
