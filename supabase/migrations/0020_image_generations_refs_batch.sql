-- Add reference image URLs + batch grouping to image_generations.
-- reference_urls: jsonb array of public http(s) URLs that conditioned the
--   generation (Gemini "edit" / style-reference flow).
-- batch_id: shared uuid for all rows produced by a single generateImage()
--   call when count > 1, so the gallery can group siblings.
alter table public.image_generations
  add column if not exists reference_urls jsonb,
  add column if not exists batch_id uuid;

create index if not exists image_generations_batch_idx
  on public.image_generations (batch_id);
