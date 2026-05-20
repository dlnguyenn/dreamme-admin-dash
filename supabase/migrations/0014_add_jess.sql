-- Add tenth persona "jess" to all persona check constraints.
-- Mirrors the pattern in 0013_add_hannah.sql.

alter table public.deliveries drop constraint if exists deliveries_persona_check;
alter table public.deliveries add constraint deliveries_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess'));

alter table public.saved_captions drop constraint if exists saved_captions_persona_check;
alter table public.saved_captions add constraint saved_captions_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess'));

alter table public.tiktok_posts drop constraint if exists tiktok_posts_persona_check;
alter table public.tiktok_posts add constraint tiktok_posts_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess'));

alter table public.generated_hooks drop constraint if exists generated_hooks_persona_check;
alter table public.generated_hooks add constraint generated_hooks_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess'));

alter table public.generated_captions drop constraint if exists generated_captions_persona_check;
alter table public.generated_captions add constraint generated_captions_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess'));

alter table public.pipeline_hooks drop constraint if exists pipeline_hooks_persona_check;
alter table public.pipeline_hooks add constraint pipeline_hooks_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess'));
