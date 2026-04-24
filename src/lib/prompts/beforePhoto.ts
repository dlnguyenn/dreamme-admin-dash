/**
 * Before-photo prompt scaffolding for the DreamMe GLP-1 app.
 *
 * The goal is for Gemini 3.1 Flash Image Preview ("Nano Banana 2") to
 * produce images that look like real, unedited camera-roll snapshots —
 * the kind of "before" photo someone actually has on their phone, not
 * the kind of flattering-but-plain photo Gemini defaults to.
 *
 * Prompting rules (from the Gemini image-gen brief):
 *   1. Descriptive natural-language prose, not comma-separated tags.
 *   2. No terminal negative lists ("no bokeh, no professional lighting, ...").
 *      Describe what we DO want positively instead. Negatives embedded
 *      inside a positive sentence (as in the master template) are fine —
 *      only the tag-list pattern trips Gemini up.
 *   3. Frame the photo's origin story — who took it and why it exists.
 *   4. Use photographic language to control composition/lighting.
 *
 * The master template fuses the DreamMe-specific weight target
 * ({TARGET_LB}) into the AVATAR_DESCRIPTION slot so "before" still means
 * "visibly heavier than the reference" without losing the scenario
 * framing.
 *
 * See C:\\Users\\Dan\\Downloads\\dreamme_before_photo_generator_brief.md
 * for the source brief. `candid_unaware` is deliberately excluded.
 */

export type BeforeScenario =
  | "bathroom_mirror"
  | "bedroom_mirror"
  | "family_photo"
  | "outdoor_event"
  | "restaurant_or_dinner";

export const SCENARIOS: readonly BeforeScenario[] = [
  "bathroom_mirror",
  "bedroom_mirror",
  "family_photo",
  "outdoor_event",
  "restaurant_or_dinner",
] as const;

/** Short, human-readable labels for UI chips. */
export const SCENARIO_LABELS: Record<BeforeScenario, string> = {
  bathroom_mirror: "Bathroom mirror",
  bedroom_mirror: "Bedroom mirror",
  family_photo: "Family photo",
  outdoor_event: "Outdoor event",
  restaurant_or_dinner: "Dinner out",
};

const SCENARIO_BLOCKS: Record<BeforeScenario, string> = {
  bathroom_mirror:
    "She is taking a mirror selfie in a cluttered home bathroom. Her phone is visible in her hand, held at chest or hip height pointed at the mirror. The bathroom counter behind or beside her is cluttered with toothpaste tubes, hair products, contact lens cases, makeup, and other everyday items. Harsh overhead vanity bulb lighting from above creates unflattering shadows under her eyes and chin. There may be water spots, toothpaste splatter, or smudges on the mirror. She is wearing casual loungewear, pajamas, or workout clothes. Her expression is neutral or slightly self-conscious — not a posed smile.",
  bedroom_mirror:
    "She is taking a mirror selfie in her bedroom. The bed behind her is unmade with rumpled sheets, pillows pushed around, and clothes piled on top. Her phone is visible in her hand. The room is lit by natural daylight through a window, slightly overexposed near the window. The closet door may be partially open showing clothes hanging inside. She wears casual loungewear and her expression is slightly tired, disengaged, or just neutral — this is a quick snapshot, not a curated post.",
  family_photo:
    "She is standing in a hallway, living room, or kitchen, photographed by a family member from chest height. Her arms hang slightly awkwardly at her sides — she doesn't quite know what to do with them. The horizon is slightly tilted because the photographer wasn't being careful with framing. Warm indoor lighting from overhead fixtures or lamps. Family photos, furniture, mail on a counter, and everyday clutter visible in the background. Her smile is polite but a little stiff — the way people smile when a relative says \"let me get a picture real quick.\"",
  outdoor_event:
    "She is standing at an outdoor event — a stadium, a backyard barbecue, a tourist destination, or a park — photographed by a friend or spouse. Other people, bystanders, or crowds are visible in the background going about their own business, not posing. Harsh midday sun causes her to squint slightly. She wears a casual t-shirt, graphic tee, or simple top with jeans or shorts. Sunglasses may be perched on top of her head. The sky is slightly overexposed. The composition is centered but uninspired — a \"we were here\" photo, not an artistic shot.",
  restaurant_or_dinner:
    "She is sitting at a table at a casual restaurant, diner, or family dinner, photographed across the table by someone she's eating with. Plates of food, drinks, condiments, and a phone are visible on the table in front of her. The restaurant or dining room background is visible behind her — other patrons, booth seating, or a home dining room with family members partially in frame. Warm indoor restaurant lighting or overhead dining room light. Her expression is mid-conversation or politely smiling for the quick photo.",
};

/**
 * Assemble the final prompt for a single image generation. The master
 * template stays constant across scenarios — only the middle paragraph
 * (the scenario block) and the weight target vary.
 */
export function buildBeforePhotoPrompt(
  scenario: BeforeScenario,
  targetLb: number,
): string {
  const scenarioBlock = SCENARIO_BLOCKS[scenario];
  return [
    `A candid amateur photograph found in someone's personal camera roll, the kind of casual snapshot a family member might take and never edit. The subject is the woman in the reference photo — maintain her exact facial features, hair, and skin tone — adapted to look visibly heavier at approximately ${targetLb} pounds, with a fuller face, softer jawline, fuller cheeks, and rounder body shape.`,
    "",
    scenarioBlock,
    "",
    `The photo has the unmistakable look of an unedited iPhone snapshot: harsh ambient lighting that doesn't flatter, deep depth of field with everything in focus from foreground to background, no portrait mode blur, no skin smoothing, no professional retouching. Real skin texture is visible — pores, slight blemishes, natural shine. The composition is slightly awkward and unstudied, the kind of framing that happens when a non-photographer holds up a phone without thinking about it. Color and sharpness match a default iPhone camera with no filters applied. The setting feels lived-in and cluttered with everyday objects visible — this is a real moment in a real life, not a styled photoshoot.`,
  ].join("\n");
}

/**
 * Pick two distinct scenarios uniformly at random. Used for the default
 * `count = 2` batch path so creators always see two different settings
 * side-by-side (instead of risking two bathroom-mirror photos in a row).
 */
export function pickTwoScenarios(): [BeforeScenario, BeforeScenario] {
  const pool = [...SCENARIOS];
  // Fisher–Yates on a 5-element array; we only need the first 2.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [pool[0], pool[1]];
}

/**
 * Pick N scenarios at random, allowing repeats. Used when `count` is not
 * exactly 2 (extremely rare — admins testing; the UI default is 2).
 */
export function pickNScenarios(n: number): BeforeScenario[] {
  const out: BeforeScenario[] = [];
  for (let i = 0; i < n; i++) {
    out.push(SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]);
  }
  return out;
}
