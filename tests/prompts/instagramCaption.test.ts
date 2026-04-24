import { describe, it, expect } from "vitest";
import {
  INSTAGRAM_CHAR_CEILING,
  INSTAGRAM_CHAR_TARGET,
  buildInstagramCaptionPrompt,
  buildInstagramCompressPrompt,
  stripTrailingHashtags,
} from "@/lib/prompts/instagramCaption";
import { PERSONAS, PERSONA_IDS } from "@/lib/personas";

const SAMPLE_HOOK =
  "what no one tells you about the first week on a GLP-1: the food noise goes quiet";

describe("instagramCaption prompt module", () => {
  it("exports the hard 2000-char ceiling with target headroom below it", () => {
    expect(INSTAGRAM_CHAR_CEILING).toBe(2000);
    expect(INSTAGRAM_CHAR_TARGET).toBeLessThan(INSTAGRAM_CHAR_CEILING);
    expect(INSTAGRAM_CHAR_TARGET).toBeGreaterThan(1500);
  });

  it("builder weaves the hook, the ceiling number, and the persona voice anchor into the prompt", () => {
    const persona = PERSONAS[PERSONA_IDS[0]];
    const prompt = buildInstagramCaptionPrompt(SAMPLE_HOOK, PERSONA_IDS[0]);
    expect(prompt).toContain(SAMPLE_HOOK);
    expect(prompt).toContain(String(INSTAGRAM_CHAR_CEILING));
    expect(prompt).toContain(persona.name);
    expect(prompt).toContain(persona.tagline);
  });

  it("builder explicitly forbids hashtags and tip-list formatting markers", () => {
    const prompt = buildInstagramCaptionPrompt(SAMPLE_HOOK, PERSONA_IDS[0]);
    // Forbidden by spec — user does not want any hashtag generation.
    expect(prompt.toLowerCase()).toContain("no hashtags");
    // Forbidden TikTok-style formatting must be explicitly called out.
    expect(prompt).toMatch(/✅/);
    expect(prompt).toMatch(/👉/);
    // No listicle / numbered tips.
    expect(prompt.toLowerCase()).toMatch(/no listicle|no numbered tips/);
  });

  it("builder does NOT smuggle affirmative add-hashtag instructions from the TikTok prompt", () => {
    const prompt = buildInstagramCaptionPrompt(SAMPLE_HOOK, PERSONA_IDS[0]);
    // Belt-and-suspenders guard: the prompt should never include a phrase
    // that actively asks Claude to produce hashtags. (Negated
    // "do NOT include hashtags" and "no hashtags" ARE allowed.)
    expect(prompt).not.toMatch(/\badd hashtags?\b/i);
    expect(prompt).not.toMatch(/\bwith (?:some |a few )?hashtags?\b/i);
    expect(prompt).not.toMatch(/append (?:some |a few )?hashtags?/i);
  });

  it("builder appends editor notes when provided, omits the block when missing", () => {
    const withNotes = buildInstagramCaptionPrompt(
      SAMPLE_HOOK,
      PERSONA_IDS[0],
      "lean into the quiet relief angle, not the weight-loss angle",
    );
    expect(withNotes).toContain("ADDITIONAL CONTEXT");
    expect(withNotes).toContain("quiet relief angle");

    const withoutNotes = buildInstagramCaptionPrompt(
      SAMPLE_HOOK,
      PERSONA_IDS[0],
    );
    expect(withoutNotes).not.toContain("ADDITIONAL CONTEXT");
  });

  it("builder swaps persona voice anchors correctly across personas", () => {
    if (PERSONA_IDS.length < 2) return;
    const a = buildInstagramCaptionPrompt(SAMPLE_HOOK, PERSONA_IDS[0]);
    const b = buildInstagramCaptionPrompt(SAMPLE_HOOK, PERSONA_IDS[1]);
    expect(a).toContain(PERSONAS[PERSONA_IDS[0]].name);
    expect(b).toContain(PERSONAS[PERSONA_IDS[1]].name);
    // If persona names differ, the two prompts should diverge on that name.
    if (PERSONAS[PERSONA_IDS[0]].name !== PERSONAS[PERSONA_IDS[1]].name) {
      expect(a).not.toContain(PERSONAS[PERSONA_IDS[1]].name);
    }
  });

  it("compress builder references the ceiling, the oversized caption, and the 'no hashtags' guard", () => {
    const oversized =
      "x".repeat(INSTAGRAM_CHAR_CEILING + 50) + " stray tail line";
    const prompt = buildInstagramCompressPrompt(oversized, PERSONA_IDS[0]);
    expect(prompt).toContain(String(INSTAGRAM_CHAR_CEILING));
    expect(prompt).toContain(String(oversized.length));
    expect(prompt.toLowerCase()).toContain("do not add hashtags");
    expect(prompt).toContain(oversized);
  });

  it("stripTrailingHashtags removes terminal hashtag runs but preserves body text", () => {
    const body = "short caption body.\n\nanother paragraph with real words.";
    const withTags = `${body}\n\n#glp1 #weightloss #journey`;
    expect(stripTrailingHashtags(withTags)).toBe(body);
  });

  it("stripTrailingHashtags leaves inline #mentions mid-body alone", () => {
    const body = "the #food noise went quiet, and I wasn't ready for it.";
    expect(stripTrailingHashtags(body)).toBe(body);
  });

  it("stripTrailingHashtags handles captions that already have no tags (idempotent)", () => {
    const body = "no tags here — just a short thought about the quiet.";
    expect(stripTrailingHashtags(body)).toBe(body);
    // Running twice yields the same result.
    expect(stripTrailingHashtags(stripTrailingHashtags(body))).toBe(body);
  });
});
