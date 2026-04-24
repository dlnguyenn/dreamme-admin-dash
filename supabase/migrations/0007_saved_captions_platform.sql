-- Platform discriminator for saved_captions: lets a single hook spawn
-- parallel TikTok and Instagram caption rows. Existing rows are all
-- TikTok, so default to 'tiktok' for zero-downtime backfill.

alter table public.saved_captions
  add column if not exists platform text not null default 'tiktok';

alter table public.saved_captions
  drop constraint if exists saved_captions_platform_chk;

alter table public.saved_captions
  add constraint saved_captions_platform_chk
  check (platform in ('tiktok','instagram'));

create index if not exists saved_captions_platform_idx
  on public.saved_captions (platform);
