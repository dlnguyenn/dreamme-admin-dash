/**
 * Accessory Studio: new companion-fish accessories in the lootbox 1-3 art
 * style. Server-only.
 *
 * Pipeline (each step is its own API call so the UI can show and redo it):
 *   1. onfish  — Gemini draws the item on Sushi using Dan's prompt
 *   2. extract — Gemini edit: delete the fish, keep only the item
 *      (or) match — Gemini draws the item standalone, copying the silhouette
 *      of an existing accessory. Used when step 2 is refused (licensed
 *      characters come back PROHIBITED_CONTENT) or for "like X but Y".
 *   3. vectorize — Recraft /images/vectorize, then `cleanRecraftSvg`
 *   4. normalize — client side (needs getBBox), onto a 1920x1080 frame
 */
import type { AccessoryRow, AccessorySlot } from "./accessory-studio-shared";
import { SERVICE_ROLE, SUPABASE_ANON, SUPABASE_URL } from "./image-generation";

export const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY ?? "";
const RECRAFT_API = "https://external.api.recraft.ai/v1";

// Dan's Gemini prompt, verbatim, with the "how it sits on the head"
// sentence swapped per slot ({FIT}).
const BASE_PROMPT =
  "Flat vector, {SUBJECT} with contrasting-color accents (designed to match a soft, rounded mascot character style in reference image 1.) Use contrasting colors against coral pink for the {ITEM}. Minimalist, kawaii-inspired illustration with smooth organic shapes, no sharp edges, no outlines. Flat 2D art style using layered depth. Solid flat color only, no gradients, no texture, no drop shadows, no cast shadows, no offset shadows, no extruded edges, no bevel, no emboss, no rim lighting. Shadow detail created only by smaller darker flat shapes. Simple frame geometry with rounded corners. no contact shadows, no ambient occlusion shadows, {FIT} Designed as a standalone accessory asset, centered, balanced, and scalable. Clean SVG-style vector paths optimized for animation and rigging. White background.\n\nPut the {ITEM} on the fish.";

const FIT: Record<AccessorySlot, string> = {
  hat: "no gap between hat base and head. hat base sits flush against and slightly overlaps the top of the character's head, hat brim overlaps character silhouette naturally as if worn.",
  glasses:
    "no gap between frame and face. the glasses sit on the character's face over the eyes, the frame overlaps the face naturally as if worn.",
  neck: "no gap between the item and the body. the item is worn around the character's neck just below the head, overlapping the body silhouette naturally as if worn.",
  handheld:
    "the item is held in front of the character by one fin, overlapping the body naturally, and is about the size of the character's head.",
};

const STYLE_TAIL =
  "Minimalist, kawaii-inspired illustration with smooth organic shapes, no sharp edges, no outlines. Flat 2D art style using layered depth. Solid flat color only, no gradients, no texture, no drop shadows, no cast shadows, no offset shadows, no extruded edges, no bevel, no emboss, no rim lighting. Shadow detail created only by smaller darker flat shapes. Designed as a standalone accessory asset, centered, balanced, and scalable. Clean SVG-style vector paths optimized for animation and rigging. The item alone, no character, plain solid white background.";

export function onFishPrompt(item: string, subject: string, slot: AccessorySlot): string {
  return BASE_PROMPT.replaceAll("{SUBJECT}", subject)
    .replaceAll("{ITEM}", item)
    .replace("{FIT}", FIT[slot]);
}

/** "Delete the fish" works; "output only the X" keeps the fish. */
export function extractPrompt(item: string): string {
  return `Edit reference image 1: delete the fish character completely (body, face, eyes, cheeks, fins, tail). Keep ONLY the ${item}, unchanged in shape, colors, angle and flat 2D style. If the ${item} has lenses or see-through parts, they must be empty with NO eyes drawn inside. The ${item} floats alone. Plain solid pure white background (#FFFFFF), no waves, no card, no frame, no shadow, nothing else.`;
}

export function matchPrompt(item: string, subject: string): string {
  return `Flat vector ${item}: ${subject}. Reference image 1 is an existing accessory from the same set: match its EXACT silhouette, three-quarter angle, proportions and size, changing only what is described here. ${STYLE_TAIL}`;
}

export function recraftConfigured(): boolean {
  return !!RECRAFT_API_KEY;
}

/** Raster URL -> Recraft SVG text (cleaned, not yet normalized). */
export async function vectorizeImage(imageUrl: string): Promise<string> {
  if (!RECRAFT_API_KEY) throw new Error("RECRAFT_API_KEY is not set");
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`could not fetch image (${img.status})`);
  const mime = img.headers.get("content-type") ?? "image/png";
  const form = new FormData();
  form.append("file", new Blob([await img.arrayBuffer()], { type: mime }), "image.png");
  const res = await fetch(`${RECRAFT_API}/images/vectorize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RECRAFT_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Recraft vectorize failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { image?: { url?: string } };
  const svgUrl = json.image?.url;
  if (!svgUrl) throw new Error("Recraft returned no SVG url");
  const svg = await fetch(svgUrl);
  if (!svg.ok) throw new Error(`could not fetch Recraft SVG (${svg.status})`);
  return cleanRecraftSvg(await svg.text());
}

/**
 * Strip Recraft's c2pa manifest and sizing attrs, drop the full-canvas
 * near-white background path, and convert rgb() fills to hex.
 */
export function cleanRecraftSvg(svg: string): string {
  let s = svg
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/<\?xml[^>]*>\s*/g, "")
    .replace(/\s(width|height|style|preserveAspectRatio|xmlns:c2pa)="[^"]*"/g, "")
    .replace(/\stransform="translate\(0,0\)"/g, "")
    .replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (_m, r, g, b) =>
      "#" + [r, g, b].map((v: string) => Number(v).toString(16).padStart(2, "0")).join(""),
    );
  s = s.replace(/<path[^>]*fill="#([0-9a-f]{6})"[^>]*d="M 0 0 L \d+ 0 [^"]*"\/>\s*/g, (m, hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.min(r, g, b) >= 235 ? "" : m;
  });
  return s;
}

// --- accessory_generations table -------------------------------------------

function headers(extra: Record<string, string> = {}) {
  const key = SERVICE_ROLE || SUPABASE_ANON;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export async function insertAccessory(row: Omit<AccessoryRow, "id" | "created_at">): Promise<AccessoryRow> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/accessory_generations`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`accessory_generations insert failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (Array.isArray(data) ? data[0] : data) as AccessoryRow;
}

export async function listAccessories(limit = 100): Promise<AccessoryRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/accessory_generations?select=*&order=created_at.desc&limit=${limit}`,
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`accessory_generations list failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AccessoryRow[];
}

export async function getAccessory(id: string): Promise<AccessoryRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/accessory_generations?select=*&id=eq.${encodeURIComponent(id)}`,
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`accessory_generations get failed: ${res.status}`);
  const rows = (await res.json()) as AccessoryRow[];
  return rows[0] ?? null;
}

export async function deleteAccessory(id: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/accessory_generations?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`accessory_generations delete failed: ${res.status} ${await res.text()}`);
}
