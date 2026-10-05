/**
 * Background Studio: purchasable home-screen backgrounds for Sushi.
 * Server-only.
 *
 * The one rule every background must follow: Sushi swims to wherever the
 * user taps, so any point on the screen has to be somewhere a fish can be.
 * That means fully underwater top to bottom (no sky, no waterline, no air
 * pocket), a side-on view into an open space, scenery at the walls / back /
 * floor, nothing big in the middle. The prompt below encodes it; the four
 * reference images (two style refs, two backgrounds that pass the rule)
 * live in the public bucket under backgrounds/refs/.
 */
import type { BackgroundRow } from "./background-studio-shared";
import { BUCKET, SERVICE_ROLE, SUPABASE_ANON, SUPABASE_URL } from "./image-generation";

export function refUrls(): string[] {
  const base = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/backgrounds/refs`;
  return ["style-1.jpg", "style-2.jpg", "ok-1.jpg", "ok-2.jpg"].map((f) => `${base}/${f}`);
}

const NEW_PROMPT = `Reference images 1 and 2 show our app's illustration style. Reference images 3 and 4 are two existing backgrounds that WORK for our app; follow their kind of composition. Copy the rendering style exactly: flat storybook shapes with soft rounded edges, fine grainy paper texture on every surface, speckled details, no outlines, cozy and cheerful. Do NOT draw the pink fish, the turtle, or any character, animal, person, text, logo or UI.

CRITICAL LAYOUT RULE: in the app a small coral-pink cartoon fish swims to wherever the user taps, so it can be ANYWHERE on the screen, from the very top to the very bottom and edge to edge. Every part of this picture must therefore be a place a fish can plausibly be in: the ENTIRE image is underwater (water fills the whole frame, including the very top; there is NO sky, NO water surface or waterline, NO air pocket, NO land above water). It is a side-on, eye-level view into a deep, open, roomy 3D space, like looking into a diorama or a room. Put the scenery around the edges, on the back wall or far background, and on the floor; leave the middle of the space open and airy so the fish can swim in front of everything. No large objects blocking the center, no tall walls of rock or plants in the foreground. Soft floating bubbles and light throughout. The whole image is one continuous seamless scene from the top edge to the bottom edge: no bands, boxes, panels, frames, borders, vignettes or darkened areas. Tall 9:16 phone wallpaper; keep the important scenery within the middle 80 percent of the width.

Theme: `;

export function newBackgroundPrompt(name: string, theme: string): string {
  return `${NEW_PROMPT}${name}: ${theme}`;
}

export function editBackgroundPrompt(instruction: string): string {
  return `Edit reference image 1: ${instruction}. Keep everything else exactly the same: same art style, grainy texture, colors, composition and every object in the same place. The image must stay fully underwater from the top edge to the bottom edge (no sky, no waterline, no air pocket) and be one continuous seamless scene with no bands, boxes, panels, borders or darkened areas.`;
}

// --- shop_backgrounds table --------------------------------------------------

function headers(extra: Record<string, string> = {}) {
  const key = SERVICE_ROLE || SUPABASE_ANON;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export async function insertBackground(row: Omit<BackgroundRow, "id" | "created_at">): Promise<BackgroundRow> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shop_backgrounds`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`shop_backgrounds insert failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (Array.isArray(data) ? data[0] : data) as BackgroundRow;
}

export async function listBackgrounds(): Promise<BackgroundRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shop_backgrounds?select=*&order=created_at.asc`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`shop_backgrounds list failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BackgroundRow[];
}

export async function deleteBackground(id: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shop_backgrounds?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`shop_backgrounds delete failed: ${res.status} ${await res.text()}`);
}
