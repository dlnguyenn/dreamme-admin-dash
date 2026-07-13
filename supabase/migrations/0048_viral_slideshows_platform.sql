-- Multi-platform support for the Viral Slideshows tool. Adds a `platform`
-- discriminator so Instagram carousels can live alongside TikTok slideshows
-- in the same table. The existing `tiktok_url` column now holds the post URL
-- for any platform (kept its name to avoid churn); dedup still keys on it.

alter table public.viral_slideshows
  add column if not exists platform text not null default 'tiktok';

create index if not exists viral_slideshows_platform_idx
  on public.viral_slideshows (platform, created_at desc);
