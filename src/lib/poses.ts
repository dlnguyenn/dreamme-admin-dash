/**
 * Stable pose-reference identifiers for the Image Studio pose picker.
 * Source of truth for the named slots seeded in the `pose_references`
 * table by supabase/migrations/0026_pose_references.sql. Server routes
 * validate incoming `name` parameters against this list.
 *
 * Mirrors src/lib/avatars.ts. Poses drive *composition* references (body
 * pose / framing), distinct from avatars which drive *identity* references.
 */
export const POSE_IDS = [
  "standing",
  "car-selfie",
  "walking",
  "indoor-selfie",
  "over-shoulder",
  "hands-on-hips",
  "mirror-ootd",
  "candid",
] as const;

export type PoseId = (typeof POSE_IDS)[number];

export function isPoseId(value: string): value is PoseId {
  return (POSE_IDS as readonly string[]).includes(value);
}
