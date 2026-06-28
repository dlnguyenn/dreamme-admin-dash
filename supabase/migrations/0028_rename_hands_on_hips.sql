-- Rename pose slot: hands-on-hips -> mirror-covered-face
--
-- Rename in place so any uploaded image is preserved (the slot is currently
-- empty, but this keeps the migration safe either way). Written idempotently
-- for the re-running migrate runner — same pattern as 0027: 0026 keeps
-- re-seeding empty 'hands-on-hips', so the guarded rename moves a real image
-- on the first pass and the trailing delete sweeps any re-seeded empty
-- legacy row on later passes.

update public.pose_references
  set name = 'mirror-covered-face'
  where name = 'hands-on-hips'
    and not exists (
      select 1 from public.pose_references p where p.name = 'mirror-covered-face'
    );

insert into public.pose_references (name) values
  ('mirror-covered-face')
on conflict (name) do nothing;

delete from public.pose_references
  where name = 'hands-on-hips'
    and image_url is null;
