-- Expand allowed persona set from 3 to 8.
-- Adds: mia, abby, diane, sydney, maddy.

alter table public.deliveries drop constraint if exists deliveries_persona_check;
alter table public.deliveries add constraint deliveries_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy'));

alter table public.saved_captions drop constraint if exists saved_captions_persona_check;
alter table public.saved_captions add constraint saved_captions_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy'));

alter table public.tiktok_posts drop constraint if exists tiktok_posts_persona_check;
alter table public.tiktok_posts add constraint tiktok_posts_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy'));

alter table public.generated_hooks drop constraint if exists generated_hooks_persona_check;
alter table public.generated_hooks add constraint generated_hooks_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy'));

alter table public.generated_captions drop constraint if exists generated_captions_persona_check;
alter table public.generated_captions add constraint generated_captions_persona_check
  check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy'));
