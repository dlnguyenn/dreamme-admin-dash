import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const APIFY_KEY = process.env.APIFY_KEY;
if (!APIFY_KEY) {
  console.error("APIFY_KEY not set in .env.local");
  process.exit(1);
}

const ACTOR_ID = process.env.APIFY_TIKTOK_ACTOR_ID ?? "clockworks~tiktok-scraper";
const PROFILES = ["andreaglp1", "glp1withemma", "glpolivia"];
const RESULTS_PER_PAGE = 5;
const OUT = path.resolve("tests/fixtures/apify-tiktok.json");

async function main() {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    profiles: PROFILES,
    resultsPerPage: RESULTS_PER_PAGE,
    shouldDownloadCovers: false,
    shouldDownloadVideos: false,
    shouldDownloadSlideshowImages: true,
  };

  console.log(`POST ${ACTOR_ID}  profiles=${PROFILES.join(",")}  n=${RESULTS_PER_PAGE}`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!res.ok) {
    console.error(`Apify failed: ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }

  const data = await res.json();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));

  const count = Array.isArray(data) ? data.length : 0;
  console.log(`Saved ${count} items to ${OUT} (${secs}s)`);

  if (!Array.isArray(data) || data.length === 0) {
    console.error("\nEMPTY RESPONSE. Raw body:");
    console.error(JSON.stringify(data).slice(0, 500));
    process.exit(2);
  }

  const first = data[0] as Record<string, unknown>;
  console.log("\nFirst item top-level keys:");
  console.log(Object.keys(first).sort().join(", "));
  console.log("\nauthorMeta keys:", first.authorMeta ? Object.keys(first.authorMeta as object).join(", ") : "(missing)");
  console.log("videoMeta keys:", first.videoMeta ? Object.keys(first.videoMeta as object).join(", ") : "(missing)");
  console.log("has slideshowImageLinks:", Array.isArray(first.slideshowImageLinks));
  console.log("has images:", Array.isArray(first.images));
  console.log("isSlideshow:", first.isSlideshow);

  const perAuthor = new Map<string, number>();
  for (const item of data as Array<{ authorMeta?: { name?: string } }>) {
    const name = item.authorMeta?.name ?? "?";
    perAuthor.set(name, (perAuthor.get(name) ?? 0) + 1);
  }
  console.log("\nItems per author:");
  for (const [name, n] of perAuthor) console.log(`  ${name}: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
