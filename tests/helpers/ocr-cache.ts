import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.resolve("tests/fixtures/ocr-cache");

function keyFor(kind: "ocr" | "cat", input: string): string {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return path.join(CACHE_DIR, `${kind}-${hash}.txt`);
}

async function readCache(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function writeCache(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, "utf8");
}

export function cachedOcr(deps: {
  extract: (url: string) => Promise<string>;
  categorize: (hook: string) => Promise<string>;
}) {
  let extractMisses = 0;
  let categorizeMisses = 0;
  return {
    extract: async (url: string): Promise<string> => {
      const file = keyFor("ocr", url);
      const hit = await readCache(file);
      if (hit !== null) return hit;
      extractMisses++;
      const value = await deps.extract(url);
      await writeCache(file, value);
      return value;
    },
    categorize: async (hook: string): Promise<string> => {
      const file = keyFor("cat", hook);
      const hit = await readCache(file);
      if (hit !== null) return hit;
      categorizeMisses++;
      const value = await deps.categorize(hook);
      await writeCache(file, value);
      return value;
    },
    stats: () => ({ extractMisses, categorizeMisses }),
  };
}
