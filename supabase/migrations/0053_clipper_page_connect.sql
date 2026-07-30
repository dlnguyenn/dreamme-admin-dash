-- Clipper self-serve Facebook page connect.
--
-- page_connected_at records when a page URL was last set, from either the
-- clipper's own dashboard (/api/clippers/connect-page) or the admin tab, so
-- Dan can see who wired up their own page.
alter table if exists public.clippers
  add column if not exists page_connected_at timestamptz;

-- The daily view refresh filters on exactly this pair.
create index if not exists clipper_videos_platform_active_idx
  on public.clipper_videos (platform, active);

-- Discovery and the connect route both look up a clipper's rows by page URL.
create index if not exists clippers_facebook_page_url_idx
  on public.clippers (facebook_page_url)
  where facebook_page_url is not null;
