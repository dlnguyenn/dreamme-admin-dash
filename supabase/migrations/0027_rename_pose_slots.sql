-- Rename two pose-reference slots:
--   sitting -> car-selfie
--   leaning -> indoor-selfie
--
-- 'sitting' may already hold an uploaded image, so we rename the row IN
-- PLACE (carrying image_url) rather than delete+reinsert. The stored
-- public URL keeps its old `poses/sitting-<id>.jpg` path — that's cosmetic
-- and self-heals on the next replace (setPoseImage deletes the old blob and
-- writes poses/car-selfie-<id>.jpg).
--
-- Written idempotently for the migrate runner, which re-applies every .sql
-- file: 0026 keeps seeding empty 'sitting'/'leaning', so each run re-creates
-- those null rows; the guarded renames preserve the real image into the new
-- name on the first pass, and the trailing delete sweeps any re-seeded empty
-- legacy rows on every subsequent pass.

update public.pose_references
  set name = 'car-selfie'
  where name = 'sitting'
    and not exists (
      select 1 from public.pose_references p where p.name = 'car-selfie'
    );

update public.pose_references
  set name = 'indoor-selfie'
  where name = 'leaning'
    and not exists (
      select 1 from public.pose_references p where p.name = 'indoor-selfie'
    );

-- Ensure the renamed slots exist even if the legacy ones were already gone.
insert into public.pose_references (name) values
  ('car-selfie'),
  ('indoor-selfie')
on conflict (name) do nothing;

-- Sweep legacy slots only when empty, so we never drop a populated image.
delete from public.pose_references
  where name in ('sitting', 'leaning')
    and image_url is null;
