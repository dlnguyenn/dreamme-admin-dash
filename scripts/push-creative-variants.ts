/**
 * Push the v3 (Comic Sans v2) creative variants live on Meta.
 *
 * For each variant:
 *   1. Upload the composited PNG → get image_hash
 *   2. Create a new ad_creative with that image_hash + matching message/headline
 *   3. Update the existing variant ad's creative_id to point at the new creative
 *
 * Existing ad IDs and names stay the same; only the underlying creative swaps.
 * No campaign/ad-set changes, no learning reset, no spend pause.
 *
 * Usage:
 *   npm run push-variants                 # push all 5
 *   npm run push-variants -- --only food-critic
 *   npm run push-variants -- --dry-run    # show what would happen, no writes
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.META_ACCESS_TOKEN ?? "";
const ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID ?? "act_1575502753719515";
const API_VERSION = process.env.META_API_VERSION ?? "v22.0";
const PAGE_ID = "935570636301545";
const APP_LINK =
  "https://itunes.apple.com/WebObjects/MZStore.woa/wa/redirectToContent?id=6755569693";

interface VariantPush {
  slug: string;
  adId: string;
  creativeName: string;
  message: string; // Meta's caption shown above the ad in feed
  headline: string; // Headline shown under the image
  pngPath: string;
}

const VARIANTS: VariantPush[] = [
  {
    slug: "food-scan-rating",
    adId: "120243142443320622",
    creativeName: "Comic Sans v3 — Food Scan Rating",
    message:
      "scanned my 'safe' lunch — turns out it's a 3/10 on the GLP-1 scale 💀 the app doesn't lie #dreammeapp",
    headline: "GLP-1 Food Scores, Instantly",
    pngPath: "tmp/creative-variants/final/food-scan-rating.png",
  },
  {
    slug: "food-critic",
    adId: "120243142445160622",
    creativeName: "Comic Sans v3 — Food Critic",
    message:
      "every meal i pull out my phone and rate it like a food critic 😂 the GLP-1 scoring in this thing is too good #dreammeapp",
    headline: "Rate Every Meal, GLP-1 Style",
    pngPath: "tmp/creative-variants/final/food-critic.png",
  },
  {
    slug: "pet-fish-symptoms",
    adId: "120243142446480622",
    creativeName: "Comic Sans v3 — Pet Fish Symptoms",
    message:
      "i've asked my pet fish more questions about my GLP-1 symptoms than i've asked my doctor 😅 #dreammeapp",
    headline: "Symptom Help, On Demand",
    pngPath: "tmp/creative-variants/final/pet-fish-symptoms.png",
  },
  {
    slug: "top-hat-streak",
    adId: "120243142448530622",
    creativeName: "Comic Sans v3 — Top Hat Streak",
    message:
      "yes i bought my pet fish a top hat for hitting a streak — and yes that's why i kept the streak going 😂 #dreammeapp",
    headline: "The Pet That Keeps You Going",
    pngPath: "tmp/creative-variants/final/top-hat-streak.png",
  },
  {
    slug: "community",
    adId: "120243142450280622",
    creativeName: "Comic Sans v3 — Community",
    message:
      "the in-app community is the only place i can talk about my shot without weird looks from family 😂 #dreammeapp",
    headline: "Community That Gets It",
    pngPath: "tmp/creative-variants/final/community.png",
  },
];

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const DRY_RUN = args.includes("--dry-run");
const onlySlug = getArg("only");

const targets = onlySlug
  ? VARIANTS.filter((v) => v.slug === onlySlug)
  : VARIANTS;
if (targets.length === 0) {
  console.error(`No variants matched --only=${onlySlug}`);
  process.exit(1);
}

if (!TOKEN) {
  console.error("META_ACCESS_TOKEN not set in .env.local");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };

async function metaPost(
  url: string,
  body: Record<string, unknown> | URLSearchParams,
): Promise<Record<string, unknown>> {
  const init: RequestInit = body instanceof URLSearchParams
    ? { method: "POST", headers, body }
    : {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function uploadImage(pngPath: string): Promise<string> {
  const abs = path.resolve(pngPath);
  if (!fs.existsSync(abs)) throw new Error(`PNG not found: ${abs}`);
  const bytes = fs.readFileSync(abs);
  const url = `https://graph.facebook.com/${API_VERSION}/${ACCOUNT_ID}/adimages`;
  const form = new URLSearchParams({
    bytes: bytes.toString("base64"),
  });
  const result = await metaPost(url, form);
  const images = (result.images ?? {}) as Record<
    string,
    { hash?: string; url?: string }
  >;
  const first = Object.values(images)[0];
  if (!first?.hash) throw new Error(`No hash in upload response: ${JSON.stringify(result)}`);
  return first.hash;
}

async function createCreative(
  v: VariantPush,
  imageHash: string,
): Promise<string> {
  const url = `https://graph.facebook.com/${API_VERSION}/${ACCOUNT_ID}/adcreatives`;
  const objectStorySpec = {
    page_id: PAGE_ID,
    link_data: {
      link: APP_LINK,
      message: v.message,
      name: v.headline,
      image_hash: imageHash,
      call_to_action: { type: "INSTALL_MOBILE_APP" },
    },
  };
  const creativeFeaturesSpec = {
    ads_with_benefits: { enroll_status: "OPT_OUT" },
    advantage_plus_creative: { enroll_status: "OPT_OUT" },
    image_animation: { enroll_status: "OPT_OUT" },
    image_templates: { enroll_status: "OPT_OUT" },
    product_extensions: { enroll_status: "OPT_OUT" },
    site_extensions: { enroll_status: "OPT_OUT" },
    text_optimizations: { enroll_status: "OPT_OUT" },
  };
  const body = {
    name: v.creativeName,
    object_story_spec: JSON.stringify(objectStorySpec),
    degrees_of_freedom_spec: JSON.stringify({
      creative_features_spec: creativeFeaturesSpec,
    }),
  };
  const result = await metaPost(url, body);
  if (!result.id) throw new Error(`No creative id: ${JSON.stringify(result)}`);
  return String(result.id);
}

async function swapAdCreative(adId: string, creativeId: string): Promise<void> {
  const url = `https://graph.facebook.com/${API_VERSION}/${adId}`;
  await metaPost(url, { creative: JSON.stringify({ creative_id: creativeId }) });
}

async function pushOne(v: VariantPush): Promise<void> {
  process.stderr.write(`  ${v.slug.padEnd(20)} `);
  if (DRY_RUN) {
    process.stderr.write(`(dry run — would upload ${v.pngPath} → swap on ad ${v.adId})\n`);
    return;
  }
  const t0 = Date.now();
  process.stderr.write(`upload... `);
  const hash = await uploadImage(v.pngPath);
  process.stderr.write(`${hash.slice(0, 8)}  create... `);
  const creativeId = await createCreative(v, hash);
  process.stderr.write(`${creativeId}  swap... `);
  await swapAdCreative(v.adId, creativeId);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`done (${elapsed}s)\n`);
}

async function main() {
  process.stderr.write(
    `Pushing ${targets.length} variant(s)${DRY_RUN ? " (dry run)" : ""}...\n`,
  );
  let ok = 0;
  let failed = 0;
  for (const v of targets) {
    try {
      await pushOne(v);
      ok++;
    } catch (e) {
      process.stderr.write(`FAILED: ${(e as Error).message}\n`);
      failed++;
    }
  }
  process.stderr.write(`\n${ok}/${targets.length} succeeded${failed ? `, ${failed} failed` : ""}.\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e: Error) => {
  console.error(`\nERROR: ${e.message}\n`);
  process.exit(1);
});
