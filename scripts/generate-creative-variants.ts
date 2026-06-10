/**
 * Two-phase creative-variant pipeline for the Comic Sans v2 copy test.
 *
 * Phase 1 (illustrations): use Gemini editImage with the control image as a
 *   style reference to generate text-free illustrations occupying the lower
 *   60% of a 4:5 canvas, with the upper 40% blank for text overlay.
 *
 * Phase 2 (composite): use sharp to render the long-form copy block on top
 *   of each illustration in the upper 40%, using Patrick Hand for a
 *   handwritten look that matches the control.
 *
 * Each phase is independently re-runnable so you can tweak copy without
 * re-generating images, or re-roll a single illustration without
 * re-rendering the whole batch.
 *
 * Usage:
 *   npm run generate-variants                              # both phases, all 5
 *   npm run generate-variants -- --phase illustrations
 *   npm run generate-variants -- --phase composite
 *   npm run generate-variants -- --only food-scan-rating
 *   npm run generate-variants -- --only top-hat-streak --phase composite
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import opentype from "opentype.js";
import { editImage } from "../src/lib/gemini";

type LineStyle = "hook" | "body" | "accent";

interface TextLine {
  text: string;
  style: LineStyle;
}

interface Variant {
  slug: string;
  name: string;
  illustrationPrompt: string;
  copy: TextLine[];
}

// Typographic hierarchy. Sizes hand-tuned for 1080×1350 portrait.
// Hook = punchy lede, larger. Body = supporting copy, smaller. Accent = CTA/punchline, brand coral.
const STYLE_CONFIG: Record<
  LineStyle,
  { size: number; color: string; lineGap: number }
> = {
  hook: { size: 70, color: "#1a1a1a", lineGap: 18 },
  body: { size: 42, color: "#2a2a2a", lineGap: 10 },
  accent: { size: 56, color: "#c94e4e", lineGap: 14 }, // DreamMe coral
};
// Extra space when transitioning between style groups (e.g., hook → body)
const GROUP_GAP = 28;

const STYLE_BASE =
  "Match the exact illustration style of the input image: cheerful cartoon-vector pink-and-coral pet fish character with closed eyes and a big happy smile, holding the pose from the reference. Composition: portrait 4:5 aspect ratio, the upper 40% of the image must be ENTIRELY BLANK PURE WHITE — leave it empty for text to be added later. The illustration occupies the LOWER 60% only, centered horizontally. DO NOT include ANY text, words, letters, or symbols in the image. No headlines, no captions, no labels. Just the illustration.";

const VARIANTS: Variant[] = [
  {
    slug: "sf-doctor-zero-answers",
    name: "Scribble Finch v2 — Doctor Zero Answers",
    illustrationPrompt: `${STYLE_BASE} Scene (lower 60% only): the same cheerful pink-and-coral pet fish character, smiling with closed eyes, holding a big stack of question marks instead of a heart. Soft floating sparkles around. White background.`,
    copy: [
      { text: "Doctor gave you zero GLP-1 answers?", style: "hook" },
      { text: "DreamMe is your self-care Tamagotchi.", style: "body" },
      { text: "Ask your pet fish anything —", style: "body" },
      { text: "symptoms, side effects, the weird stuff.", style: "body" },
      { text: "Start tracking today.", style: "accent" },
    ],
  },
  {
    slug: "sf-food-rating",
    name: "Scribble Finch v2 — Food Rating",
    illustrationPrompt: `${STYLE_BASE} Scene (lower 60% only): the same cheerful pink-and-coral pet fish character holding a smartphone (instead of the heart) that shows a plate of food on the screen with a large red "3/10" rating badge floating above it. Fish has closed eyes, big smile, surrounded by soft sparkles. White background.`,
    copy: [
      { text: "GLP-1 meals shouldn't be guesswork.", style: "hook" },
      { text: "Your pet fish scans every plate and", style: "body" },
      { text: "rates it on a GLP-1 scale (1-10).", style: "body" },
      { text: "Eat smart. No more 'safe' lunch surprises.", style: "body" },
      { text: "Start tracking today.", style: "accent" },
    ],
  },
  {
    slug: "sf-streak",
    name: "Scribble Finch v2 — Streak",
    illustrationPrompt: `${STYLE_BASE} Scene (lower 60% only): the same cheerful pink-and-coral pet fish character holding a celebratory "7-DAY STREAK" ribbon banner across its body. Soft sparkles and small confetti around. Fish has closed eyes, big smile. White background.`,
    copy: [
      { text: "Daily habits are hard on GLP-1.", style: "hook" },
      { text: "Your pet fish only grows when YOU", style: "body" },
      { text: "show up — log food, water, your shot.", style: "body" },
      { text: "Hit a streak. Watch your fish thrive.", style: "body" },
      { text: "Start tracking today.", style: "accent" },
    ],
  },
  {
    slug: "sf-community",
    name: "Scribble Finch v2 — Community",
    illustrationPrompt: `${STYLE_BASE} Scene (lower 60% only): three of the same cheerful pink-and-coral pet fish characters (one rounder, one slimmer, one with a tiny bow), all smiling with closed eyes, gathered closely with three small overlapping speech bubbles above them. White background.`,
    copy: [
      { text: "Family weird about your shot?", style: "hook" },
      { text: "DreamMe has a private community", style: "body" },
      { text: "of people on the same GLP-1 journey.", style: "body" },
      { text: "No judgment. No eye rolls.", style: "body" },
      { text: "Find your people.", style: "accent" },
    ],
  },
  {
    slug: "sf-symptom-chat",
    name: "Scribble Finch v2 — Symptom Chat",
    illustrationPrompt: `${STYLE_BASE} Scene (lower 60% only): the same cheerful pink-and-coral pet fish character inside a soft cloud-shaped chat speech bubble, smiling with closed eyes. A smartphone in the foreground showing a chat conversation with small message bubbles. White background.`,
    copy: [
      { text: "2am GLP-1 symptom panic?", style: "hook" },
      { text: "Skip WebMD. Ask your pet fish.", style: "body" },
      { text: "DreamMe's chat actually understands", style: "body" },
      { text: "nausea, fatigue, plateau, the weird stuff.", style: "body" },
      { text: "Your late-night GLP-1 buddy.", style: "accent" },
    ],
  },
];

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
function die(msg: string): never {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

const phase = getArg("phase") ?? "all";
const onlySlug = getArg("only");
const controlPath = path.resolve(
  getArg("control") ?? "assets/scribble-finch-control.png",
);
// Comic Sans MS Bold from the Windows system fonts folder. Microsoft
// licenses Comic Sans MS for use as a Windows-installed system font; we
// read the TTF locally and embed it via @font-face so libvips reliably
// renders it (its system font resolution on Windows is unreliable). The
// font file itself stays on the user's machine — only the rasterized
// output ships in the ad creative.
const fontPath =
  getArg("font") ?? "C:\\Windows\\Fonts\\comicbd.ttf";
const illustrationsDir = path.resolve("tmp/creative-variants/illustrations");
const finalDir = path.resolve("tmp/creative-variants/final");

const targets = onlySlug
  ? VARIANTS.filter((v) => v.slug === onlySlug)
  : VARIANTS;
if (targets.length === 0) {
  die(
    `No variants matched --only=${onlySlug}. Available: ${VARIANTS.map((v) => v.slug).join(", ")}`,
  );
}

// Output canvas — 4:5 portrait at 1080×1350. Anchor the text block so its
// baseline group sits near the upper rule-of-thirds line (y = H/3 = 450).
const W = 1080;
const H = 1350;
const TEXT_AREA_H = Math.round(H * 0.45); // text gets the upper ~45%

// Cache the parsed Font across composite calls.
let cachedFont: opentype.Font | null = null;
function getFont(): opentype.Font {
  if (cachedFont) return cachedFont;
  if (!fs.existsSync(fontPath))
    throw new Error(`Font not found at ${fontPath}`);
  const buf = fs.readFileSync(fontPath);
  // opentype.parse needs an ArrayBuffer; slice exactly the file's bytes
  // out of the Node Buffer's underlying ArrayBuffer.
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  );
  cachedFont = opentype.parse(ab);
  return cachedFont;
}

// Estimate the rendered height of a single line for vertical layout.
// Comic Sans's cap height + descender comes to about 1.05× the size in
// practice; we use 1.0 since the inter-line gap handles the rest.
function lineHeightFor(style: LineStyle): number {
  return STYLE_CONFIG[style].size;
}

// Shrink a line's size so its rendered width fits within `maxFraction` of
// the canvas. Prevents long hooks from bleeding off the edges. Hierarchy
// is preserved at design size when content fits; only over-long lines shrink.
const MAX_LINE_FRACTION = 0.92;
function fitFontSize(text: string, baseSize: number): number {
  const font = getFont();
  const maxW = W * MAX_LINE_FRACTION;
  let size = baseSize;
  while (size > 24 && font.getAdvanceWidth(text, size) > maxW) {
    size -= 2;
  }
  return size;
}

// Hard upper bound for where text can extend on the canvas. The Gemini
// illustration occupies the lower 60% (starts at y = H × 0.40 = 540),
// so text must end above that with a safety margin. This guarantees
// "text never overlaps the illustration."
const TEXT_BOTTOM_LIMIT = Math.round(H * 0.4) - 30; // ~510
const TEXT_TOP_MARGIN = 70;

// Single tilt angle applied to the entire text block (not per-line).
// Per-line tilts looked chaotic; one uniform angle reads as intentional
// hand-drawn design while keeping line relationships clean.
const BLOCK_TILT_DEG = -2;

function buildOverlaySvg(lines: TextLine[]): Buffer {
  const font = getFont();

  // First pass — compute total block height so we can vertically center
  // within the safe text area (above the illustration).
  let blockH = 0;
  for (let i = 0; i < lines.length; i++) {
    blockH += lineHeightFor(lines[i].style);
    if (i < lines.length - 1) {
      const sameGroup = lines[i].style === lines[i + 1].style;
      blockH += sameGroup ? STYLE_CONFIG[lines[i].style].lineGap : GROUP_GAP;
    }
  }

  // Anchor the block to the BOTTOM of the safe area so text always sits
  // tight above the illustration, regardless of block length. Leftover
  // white space goes to the top of the canvas where it reads as
  // intentional negative space rather than dead air between text and art.
  const idealBottom = TEXT_BOTTOM_LIMIT - 8; // small breath above illustration
  const blockTop = Math.max(TEXT_TOP_MARGIN, idealBottom - blockH);

  let cursor = blockTop;
  const elements: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cfg = STYLE_CONFIG[line.style];
    const renderSize = fitFontSize(line.text, cfg.size);
    const baseline = cursor + renderSize;

    const advanceWidth = font.getAdvanceWidth(line.text, renderSize);
    const x = (W - advanceWidth) / 2;
    const p = font.getPath(line.text, x, baseline, renderSize);

    elements.push(
      `<path d="${p.toPathData(2)}" fill="${cfg.color}"/>`,
    );

    cursor = baseline;
    if (i < lines.length - 1) {
      const sameGroup = line.style === lines[i + 1].style;
      cursor += sameGroup ? cfg.lineGap : GROUP_GAP;
    }
  }

  // Rotate the entire text block as a single unit around its visual center.
  const blockCx = W / 2;
  const blockCy = blockTop + blockH / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <g transform="rotate(${BLOCK_TILT_DEG} ${blockCx.toFixed(0)} ${blockCy.toFixed(0)})">
    ${elements.join("\n    ")}
  </g>
</svg>`;
  return Buffer.from(svg, "utf-8");
}

async function generateIllustration(v: Variant): Promise<Buffer> {
  if (!fs.existsSync(controlPath))
    throw new Error(`Control image not found at ${controlPath}`);
  if (!process.env.GOOGLE_API_KEY)
    throw new Error("GOOGLE_API_KEY not set in .env.local");
  const controlBytes = fs.readFileSync(controlPath);
  const result = await editImage({
    imageBytes: controlBytes,
    mimeType: "image/png",
    prompt: v.illustrationPrompt,
    timeoutMs: 180_000,
  });
  return Buffer.from(result.imageBase64, "base64");
}

async function composite(v: Variant): Promise<Buffer> {
  const illPath = path.join(illustrationsDir, `${v.slug}.png`);
  if (!fs.existsSync(illPath))
    throw new Error(
      `Illustration not found at ${illPath} — run --phase illustrations first`,
    );

  // Step 1: trim the white border off Gemini's output so we get a tight
  // bounding box around the actual illustration content. This is the fix
  // for "text-to-image gap feels uneven" — Gemini often leaves variable
  // white space above the fish, which sharp's `fit: cover` then preserves.
  const trimmed = await sharp(illPath)
    .trim({ background: "#ffffff", threshold: 10 })
    .toBuffer();
  const trimmedMeta = await sharp(trimmed).metadata();
  const trimmedW = trimmedMeta.width ?? 1;
  const trimmedH = trimmedMeta.height ?? 1;

  // Step 2: normalize the trimmed content to a CONSISTENT target height
  // across all variants. Fit-to-box would scale variants differently
  // depending on how much whitespace Gemini left (a fish with a plate
  // alongside has wide-but-short trimmed dimensions, gets blown up huge;
  // a tight square fish trims cleanly and renders correctly). Targeting
  // a fixed height makes all variants visually uniform.
  const ILLUSTRATION_TARGET_H = 700;
  const ILLUSTRATION_MAX_W = W - 80; // leave 40px margin per side
  const targetTop = Math.round(H * 0.4); // 540 — top of illustration zone
  const targetH = H - targetTop; // 810

  const scale = Math.min(
    ILLUSTRATION_TARGET_H / trimmedH,
    ILLUSTRATION_MAX_W / trimmedW,
  );
  const fittedW = Math.round(trimmedW * scale);
  const fittedH = Math.round(trimmedH * scale);
  const fittedIllustration = await sharp(trimmed)
    .resize(fittedW, fittedH, { fit: "inside" })
    .png()
    .toBuffer();

  // Step 3: place the fitted illustration on a fresh white canvas in the
  // lower region, centered horizontally and bottom-aligned vertically (so
  // the top of the illustration sits right under the text).
  const canvas = await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const placeX = Math.round((W - fittedW) / 2);
  // Top-align so the illustration starts immediately under the text band.
  // Smaller illustrations leave breathing room at the bottom of the
  // canvas — that's intentional negative space, not dead air.
  const placeY = targetTop;

  const overlaySvg = buildOverlaySvg(v.copy);

  return sharp(canvas)
    .composite([
      { input: fittedIllustration, top: placeY, left: placeX },
      { input: overlaySvg, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function main() {
  if (phase === "illustrations" || phase === "all") {
    fs.mkdirSync(illustrationsDir, { recursive: true });
    process.stderr.write(
      `Phase 1: generating ${targets.length} illustration(s) via Gemini...\n`,
    );
    for (const v of targets) {
      const t0 = Date.now();
      process.stderr.write(`  [ill] ${v.slug} ... `);
      try {
        const buf = await generateIllustration(v);
        const outPath = path.join(illustrationsDir, `${v.slug}.png`);
        fs.writeFileSync(outPath, buf);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(
          `ok (${elapsed}s, ${(buf.length / 1024).toFixed(0)} KB)\n`,
        );
      } catch (e) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`FAILED (${elapsed}s): ${(e as Error).message}\n`);
      }
    }
  }

  if (phase === "composite" || phase === "all") {
    fs.mkdirSync(finalDir, { recursive: true });
    process.stderr.write(
      `\nPhase 2: compositing text onto ${targets.length} illustration(s)...\n`,
    );
    for (const v of targets) {
      const t0 = Date.now();
      process.stderr.write(`  [comp] ${v.slug} ... `);
      try {
        const buf = await composite(v);
        const outPath = path.join(finalDir, `${v.slug}.png`);
        fs.writeFileSync(outPath, buf);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(
          `ok (${elapsed}s, ${(buf.length / 1024).toFixed(0)} KB) → ${path.relative(process.cwd(), outPath)}\n`,
        );
      } catch (e) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`FAILED (${elapsed}s): ${(e as Error).message}\n`);
      }
    }
  }

  process.stderr.write(
    `\nDone. Review final PNGs in ${path.relative(process.cwd(), finalDir)}.\n`,
  );
}

main().catch((e: Error) => die(e.message));
