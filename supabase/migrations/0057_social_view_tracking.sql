-- Organic view tracking across every publishing platform we pay for
-- (Doublespeed today, Sideshift next), for the Overview tab's 30-day
-- cumulative + daily view charts.
--
-- WHY THIS EXISTS AT ALL: nothing in the product kept a view history.
-- tiktok_posts upserts on_conflict=post_url, so yesterday's view_count is
-- destroyed every morning by /api/cron/scrape. And neither vendor gives us a
-- daily series — Doublespeed's list_posts returns a single lifetime
-- metrics.views per post, and get_account carries no analytics at all. A
-- "views gained per day" number therefore has to be *derived* by snapshotting
-- lifetime totals once a day and diffing. That is exactly the shape
-- clipper_video_views already uses (0045_clippers.sql), so these three tables
-- copy it rather than invent a second pattern.
--
-- Consequence worth knowing before reading the charts: the "gained" series can
-- only start the day the sync cron first runs. There is no history to backfill
-- from — see src/lib/socialViews.ts, which ships a publish-date proxy for the
-- window before enough snapshots exist.
--
-- All three tables are SERVICE-ROLE ONLY (RLS on, no policy), like the
-- clippers and slideshow_batches tables. Reads go through /api/overview.

-- 1) The account fleet. One row per (source, platform, handle). `source` is
--    which tool publishes to it — that is the only thing that distinguishes a
--    Doublespeed account from a Sideshift one, since both end up as ordinary
--    public profiles.
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('doublespeed', 'sideshift')),
  platform text not null check (platform in ('tiktok', 'instagram', 'facebook', 'youtube')),
  handle text not null,
  -- The vendor's own account id, so a rename doesn't orphan the row.
  external_id text,
  persona text,
  -- false = do not sync. Used for the YouTube fleet (deliberately out of
  -- scope for now) and for burned accounts, so adding YouTube later is a flag
  -- flip rather than a migration.
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (source, platform, handle)
);

create unique index if not exists social_accounts_external_idx
  on public.social_accounts (source, external_id)
  where external_id is not null;

alter table public.social_accounts enable row level security;

-- 2) One row per published post. `views` is the latest LIFETIME total, which
--    is the only thing the vendors expose. Guarded on write by
--    acceptViewUpdate() in src/lib/clipperSync.ts — public view badges are
--    rounded and bounce, so a naive write makes counts visibly fall.
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.social_accounts(id) on delete set null,
  source text not null check (source in ('doublespeed', 'sideshift')),
  -- The vendor's post id. Doublespeed's is the uuid already stored on
  -- slideshow_batch_posts.doublespeed_post_id, so batches can be joined to
  -- their real-world performance.
  source_post_id text not null,
  platform text not null,
  handle text,
  post_url text,
  posted_at timestamptz,
  persona text,
  hook text,
  num_slides int,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  views_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, source_post_id)
);

create index if not exists social_posts_posted_at_idx
  on public.social_posts (posted_at desc);
create index if not exists social_posts_source_posted_idx
  on public.social_posts (source, posted_at desc);

alter table public.social_posts enable row level security;

-- 3) Daily snapshot of each post's lifetime total. Diffing consecutive dates
--    gives views-gained-per-day; summing the latest row per post gives
--    cumulative. Same (entity, date) primary key as clipper_video_views so the
--    upsert is on_conflict=post_id,date and re-running the cron the same day
--    overwrites rather than duplicates.
create table if not exists public.social_post_views (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  date date not null,
  views bigint not null,
  primary key (post_id, date)
);

create index if not exists social_post_views_date_idx
  on public.social_post_views (date desc);

alter table public.social_post_views enable row level security;

-- 4) Two aggregate views, because PostgREST can't GROUP BY without one and the
--    raw snapshot table is ~700 posts x 30 days = well past the 1000-row
--    default page size. Both are security_invoker so they inherit the base
--    tables' RLS instead of quietly becoming a public read path.

-- Cumulative lifetime views held by each source on each snapshot date.
-- Diffing consecutive dates gives views-gained-per-day.
create or replace view public.social_daily_views
  with (security_invoker = on) as
select
  v.date,
  p.source,
  sum(v.views)::bigint as cumulative_views,
  count(*)::int        as posts
from public.social_post_views v
join public.social_posts p on p.id = v.post_id
group by v.date, p.source;

-- Lifetime views bucketed by the day the post was PUBLISHED. This is the
-- proxy series the Overview shows before enough snapshots exist to diff; it
-- answers "how did the content we shipped that day do", which is a different
-- question from "how many views did we gain that day". The UI labels which
-- one it is showing — they are not interchangeable.
create or replace view public.social_posts_by_publish_date
  with (security_invoker = on) as
select
  (p.posted_at at time zone 'utc')::date as date,
  p.source,
  sum(coalesce(p.views, 0))::bigint      as views,
  count(*)::int                          as posts
from public.social_posts p
where p.posted_at is not null
group by 1, 2;

-- Seed the Doublespeed fleet from claude/_accts_live.json (snapshot of
-- list_accounts). The sync cron upserts this on every run, so this seed only
-- has to be good enough for the Overview's empty state to say something true
-- before the first sync. YouTube rows are seeded inactive (out of scope: no
-- YouTube collector exists yet) and the one burned TikTok account is inactive
-- too, so "41 active accounts" matches what we actually read.
insert into public.social_accounts (source, platform, handle, external_id, active, note)
values
  ('doublespeed', 'tiktok', 'dreammeglp1app',   'f01aa940-3597-468b-81e0-4ff8c9adb8be', true,  null),
  ('doublespeed', 'tiktok', 'haileyyonglp1',    'a3042ad7-bc95-4e25-ac05-8b074dd59f20', true,  null),
  ('doublespeed', 'tiktok', 'rachelonglp1',     '208fd456-267a-4fed-b183-597a9ef378db', true,  null),
  ('doublespeed', 'tiktok', 'glp1withmax',      '77aafd05-bd34-4033-a975-8a584a31eafd', true,  null),
  ('doublespeed', 'tiktok', 'dianeglp1',        '157cd006-ffc3-4673-af34-9ce2ce10e406', true,  null),
  ('doublespeed', 'tiktok', 'glp1withalex',     '2e4c6e45-9620-4abd-b1ba-b0f407f1ef38', true,  null),
  ('doublespeed', 'tiktok', 'taylorglp1',       'c14188c7-13f4-491e-bfe2-b1c9e221bf5d', true,  null),
  ('doublespeed', 'tiktok', 'glp1withava',      'ced5655d-47b6-4ba2-908c-3932f08f3b20', true,  null),
  ('doublespeed', 'tiktok', 'mayawithglp1',     '9abea5ee-c093-4c57-bef6-97a22703b160', true,  null),
  ('doublespeed', 'tiktok', 'glp1withjessica',  '8d596a06-d5ea-45bc-856c-69ac4dde1dc8', true,  null),
  ('doublespeed', 'tiktok', 'sarahhglp1',       '08b59083-968b-48aa-ad30-74dde0a6cdd1', false, 'burned'),

  ('doublespeed', 'instagram', 'glp1_tips_tricks', '7481ddca-16e0-4f9d-b849-359f76d5cc61', true, null),
  ('doublespeed', 'instagram', 'julie_glp1',       'fc474c42-ab05-4495-b891-2a18cdd17cbf', true, null),
  ('doublespeed', 'instagram', 'brittanyglp1_',    '11c793f7-d798-4664-83c4-baddd3398909', true, null),
  ('doublespeed', 'instagram', 'sophiaaglp1',      '69037595-57f7-462a-9732-0df7bb9d5264', true, null),
  ('doublespeed', 'instagram', 'chrisglp1',        '4758e0e0-93e7-45b2-acf7-7d6f8c152953', true, null),
  ('doublespeed', 'instagram', 'glp1_tips',        'f482bdd2-e54f-4d39-910a-11b49fdb04c4', true, null),
  ('doublespeed', 'instagram', 'emmaaglp1',        'bf491364-b2d3-4bdd-b6bb-920ec4c4f480', true, null),
  ('doublespeed', 'instagram', 'glp1mia',          '6705c31e-3ef1-4aaa-89b9-7f5ef57e14fb', true, null),
  ('doublespeed', 'instagram', 'jimmyglp1',        '4e1beebb-fd0f-4092-8ba6-555987c68a77', true, null),
  ('doublespeed', 'instagram', 'glp1hacks',        'c39201ec-a9c5-4cd2-916d-e3b0cafac4aa', true, null),
  ('doublespeed', 'instagram', 'mikeglp1',         '251267a1-bdab-4009-99f1-09f4e974d1bb', true, null),
  ('doublespeed', 'instagram', 'mikaylaglp1',      'c9196c5d-1233-43b8-b085-7931b89ee109', true, null),
  ('doublespeed', 'instagram', 'oliviaglp1',       '8f82311d-5c7e-42db-8d82-43718b96cea3', true, null),
  ('doublespeed', 'instagram', 'hannahglp1',       'cfe17911-636b-4e5f-ba52-57321ec63467', true, null),
  ('doublespeed', 'instagram', 'angelaglp1',       'fb0af152-b85d-4e6a-b9d1-52bbf1c129a0', true, null),

  ('doublespeed', 'facebook', 'emmaaglp1',        '2db4c9ce-282a-49d0-9046-b140722d1b27', true, null),
  ('doublespeed', 'facebook', 'glp1tips',         '838e94f6-0570-4cbf-a1c1-037639a6eb67', true, null),
  ('doublespeed', 'facebook', 'jimmyglp1',        '249897ad-1ee5-4656-9a5b-21fcacd686ac', true, null),
  ('doublespeed', 'facebook', 'brittanyglp1_',    '3fd5f992-7579-4065-b7af-c363596005ee', true, null),
  ('doublespeed', 'facebook', 'glp1tipstricks',   'c23f63c1-f316-418d-9dfa-f00d517945af', true, null),
  ('doublespeed', 'facebook', 'angelaglp1',       '03f6c22f-572a-4aca-b2c7-3f5e30f2da8a', true, null),
  ('doublespeed', 'facebook', 'dreammeglp1tips',  'e80064cf-6ef5-47e9-bf73-7c46e1eefba7', true, null),
  ('doublespeed', 'facebook', 'chrisglp1',        '87d89482-868f-4d69-9118-0955641e0896', true, null),
  ('doublespeed', 'facebook', 'mikeglp1',         '806c66f4-a701-42fc-bca3-eaa3419c4296', true, null),
  ('doublespeed', 'facebook', 'oliviaglp1',       '92b74c17-2bc8-48e9-9397-73168daa19e9', true, null),
  ('doublespeed', 'facebook', 'glp1hacks',        '1cb3ca27-60a4-4f6d-80b6-9d593213b571', true, null),
  ('doublespeed', 'facebook', 'hannahglp1',       'e616a7e9-4f7b-4fe0-a162-6fc20a233504', true, null),
  ('doublespeed', 'facebook', 'mikaylaglp1',      'b54e5e99-1860-4d17-a8b7-87d520d4986a', true, null),
  ('doublespeed', 'facebook', 'sophiaaglp1',      '175ffbe2-505c-40bf-abda-9a56f81ee222', true, null),
  ('doublespeed', 'facebook', 'glp1mia',          '3a8ff5bb-7512-467d-9d40-f77a744afe18', true, null),

  ('doublespeed', 'youtube', 'glp1_tips_tricks', 'aa1da77e-cdca-495c-b5e8-4eb1f2a8690f', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'glp1_tips',        'ff9c8721-92d5-4b49-a1e4-8d7286673c5c', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'dreammeglp1tips',  'f4e8bc14-a5a3-4755-b85d-ac1e3acdeba0', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'brittanyglp1',     '76a51cdf-02e4-4973-8aad-47bc2dac990b', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'sophiaaglp1',      '3d0086a9-63ce-498f-a923-293adeb78464', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'chrisglp1',        '87f5a093-a2e7-4007-abe2-6e8178617218', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'emmaaglp1',        '5677fbd2-52d1-416d-b30d-438e4d623a61', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'glp1mia',          '02363687-b966-4974-a131-13054b34b7cb', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'jimmyglp1',        'c3ba8c43-20df-4c09-a145-c7e2680b5c08', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'glp1hacks',        '3418eaae-b7e7-45aa-a5d2-b050b5ea8b52', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'mikeglp1',         '9c12f82d-aecf-4f7f-b7e7-4d7d11b2414d', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'mikaylaglp1',      '92249162-fa74-446f-b05d-844b8ce5ebce', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'oliviaglp1',       'bf100dcd-059e-4ac1-af8a-3e42ca024753', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'hannahglp1',       'b4c7840a-a093-44fd-9d2b-9c353c2e1fde', false, 'youtube out of scope'),
  ('doublespeed', 'youtube', 'angelaglp1',       'b7ff526e-1628-461d-995a-87e2409ef930', false, 'youtube out of scope')
on conflict (source, platform, handle) do nothing;
