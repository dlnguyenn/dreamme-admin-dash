/**
 * Client-safe constants for Accessory Studio (no env, no server imports).
 * Server logic lives in `accessory-studio.ts`.
 */

export const ACCESSORY_SLOTS = ["hat", "glasses", "neck", "handheld"] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

export const ACCESSORY_MODELS = {
  flash: "gemini-3.1-flash-image-preview",
  pro: "gemini-3-pro-image",
} as const;
export type AccessoryModelKey = keyof typeof ACCESSORY_MODELS;

/** Sushi, the mascot every accessory is drawn onto. Served from /public. */
export const SUSHI_REF_PATH = "/accessory-studio/sushi.png";

/**
 * Shipped lootbox 1-3 accessories, used as silhouette references in
 * "Match existing" mode. Lootbox 4 is deliberately absent: Dan rejected
 * that art (2026-09-29) and it must never be used as a style reference.
 */
export const BUILTIN_REFS: Array<{ id: string; label: string; path: string }> = [
  { id: "batman-mask", label: "Batman mask", path: "/accessory-studio/refs/batman-mask.png" },
  { id: "duck-hat", label: "Duck hat", path: "/accessory-studio/refs/duck-hat.png" },
  { id: "penguin-hat", label: "Penguin hat", path: "/accessory-studio/refs/penguin-hat.png" },
  { id: "bunny-hat", label: "Easter bunny hat", path: "/accessory-studio/refs/bunny-hat.png" },
  { id: "pirate-hat", label: "Pirate hat", path: "/accessory-studio/refs/pirate-hat.png" },
  { id: "sun-hat", label: "Sun hat", path: "/accessory-studio/refs/sun-hat.png" },
  { id: "crown", label: "Crown", path: "/accessory-studio/refs/crown.png" },
  { id: "scuba-mask", label: "Scuba mask", path: "/accessory-studio/refs/scuba-mask.png" },
  { id: "crab-plushie", label: "Crab plushie", path: "/accessory-studio/refs/crab-plushie.png" },
  { id: "penguin-plushie", label: "Penguin plushie", path: "/accessory-studio/refs/penguin-plushie.png" },
  { id: "turtle-plushie", label: "Turtle plushie", path: "/accessory-studio/refs/turtle-plushie.png" },
];

/** Final SVG frame, matching the lootbox 2/3 Illustrator exports. */
export const FRAME_W = 1920;
export const FRAME_H = 1080;
export const FRAME_MARGIN = 43.2;

export interface AccessoryRow {
  id: string;
  slug: string;
  item: string;
  subject: string;
  slot: AccessorySlot;
  mode: "fish" | "match";
  model: string | null;
  onfish_url: string | null;
  solo_url: string | null;
  svg_url: string;
  created_at: string;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
