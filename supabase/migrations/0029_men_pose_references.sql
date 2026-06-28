-- Add the men pose-reference slots (a second pose section in the Image
-- Studio, mirroring the women set). Same single-PK pose_references table;
-- men slugs are prefixed `men-` to stay unique. Idempotent.

insert into public.pose_references (name) values
  ('men-standing'),
  ('men-car-selfie'),
  ('men-walking'),
  ('men-indoor-selfie'),
  ('men-over-shoulder'),
  ('men-mirror-covered-face'),
  ('men-mirror-ootd'),
  ('men-candid')
on conflict (name) do nothing;
