-- Persist the reference image URL used for image-to-image generations.
-- jsonb array (length 0 or 1) of public http(s) URLs that conditioned the
-- output. Lets the gallery flag generations that were edits and lets us
-- audit provenance.
alter table public.image_generations
  add column if not exists reference_urls jsonb;
