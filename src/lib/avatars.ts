/**
 * Stable avatar identifiers for the Image Studio reference picker.
 * Source of truth for the 10 named slots seeded in the `avatars`
 * table by supabase/migrations/0023_avatars.sql. Server routes
 * validate incoming `name` parameters against this list.
 *
 * These avatars are distinct from the persona system in
 * `src/lib/personas.ts` (only "diane" overlaps). Personas drive
 * caption voice; avatars drive image-generation references.
 */
export const AVATAR_IDS = [
  "alex",
  "ava",
  "diane",
  "hailey",
  "jessica",
  "max",
  "maya",
  "rachel",
  "sarah",
  "taylor",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export function isAvatarId(value: string): value is AvatarId {
  return (AVATAR_IDS as readonly string[]).includes(value);
}
