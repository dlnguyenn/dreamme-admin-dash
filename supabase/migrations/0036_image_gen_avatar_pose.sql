-- Persist which avatar (identity reference) and pose reference each
-- Image Studio generation used, so downloads can be named by the
-- convention `avatar_pose_###` (e.g. ava_car-selfie_001) instead of an
-- opaque id stem. Both nullable: MCP-path generations and non-reference
-- prompts leave them null and keep the legacy `dreamme-{id}` filename.
--
-- Values mirror the slug PKs already seeded in public.avatars
-- (0023_avatars.sql) and public.pose_references (0026_pose_references.sql,
-- renamed in 0027/0028, extended with men-* in 0029).

alter table public.image_generations
  add column if not exists avatar text,
  add column if not exists pose text;

-- Supports the download-time sequence lookup: count of generations for a
-- given (avatar, pose) up to a row's created_at gives its ### ordinal.
create index if not exists image_generations_avatar_pose_idx
  on public.image_generations (avatar, pose, created_at)
  where avatar is not null;
