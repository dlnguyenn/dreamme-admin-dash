/**
 * Stable pose-reference identifiers for the Image Studio pose picker.
 * Source of truth for the named slots seeded in the `pose_references`
 * table by supabase/migrations/0026_pose_references.sql. Server routes
 * validate incoming `name` parameters against this list.
 *
 * Mirrors src/lib/avatars.ts. Poses drive *composition* references (body
 * pose / framing), distinct from avatars which drive *identity* references.
 */
export const WOMEN_POSE_IDS = [
  "standing",
  "car-selfie",
  "walking",
  "indoor-selfie",
  "over-shoulder",
  "mirror-covered-face",
  "mirror-ootd",
  "candid",
] as const;

// Men pose slots mirror the women set, slugged with a `men-` prefix so the
// names stay unique in the single-PK pose_references table. The UI strips
// the prefix for display and groups them in a separate section.
export const MEN_POSE_IDS = [
  "men-standing",
  "men-car-selfie",
  "men-walking",
  "men-indoor-selfie",
  "men-over-shoulder",
  "men-mirror-covered-face",
  "men-mirror-ootd",
  "men-candid",
] as const;

export const POSE_IDS = [...WOMEN_POSE_IDS, ...MEN_POSE_IDS] as const;

export type PoseId = (typeof POSE_IDS)[number];

export function isPoseId(value: string): value is PoseId {
  return (POSE_IDS as readonly string[]).includes(value);
}
