/**
 * Client-safe pieces of the creative-tag taxonomy (no node imports —
 * the tagger itself lives in growth-tagging.ts, server-only).
 */

export const VISUAL_FORMATS = [
  "ugc_talking_head",
  "screen_recording",
  "greenscreen",
  "post_it",
  "letter_text",
  "montage",
  "testimonial",
  "comment_response",
  "static_illustration",
  "static_photo",
  "meme",
  "other",
] as const;

export type VisualFormat = (typeof VISUAL_FORMATS)[number];

export const VISUAL_FORMAT_LABELS: Record<VisualFormat, string> = {
  ugc_talking_head: "UGC Talking Head",
  screen_recording: "Screen Recording",
  greenscreen: "Greenscreen",
  post_it: "Post-It",
  letter_text: "Letter / Text",
  montage: "Montage",
  testimonial: "Testimonial",
  comment_response: "Comment Response",
  static_illustration: "Static Illustration",
  static_photo: "Static Photo",
  meme: "Meme",
  other: "Other",
};
