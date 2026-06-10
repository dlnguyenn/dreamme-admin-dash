-- TikTok Ads sync to power the Spark Ads section of /creatives.
-- Mirrors public.ad_insights_daily (Meta) with TikTok-specific columns
-- (identity_type, Spark creator handle, video play depth metrics).

create table if not exists public.tiktok_ad_insights_daily (
  ad_id text not null,
  date date not null,
  ad_name text,
  adgroup_id text,
  adgroup_name text,
  campaign_id text,
  campaign_name text,
  status text,
  operation_status text,
  spend numeric not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  ctr numeric,
  cpm numeric,
  video_play_actions integer not null default 0,
  video_views_p100 integer not null default 0,
  installs integer not null default 0,
  trial_starts integer not null default 0,
  purchases integer not null default 0,
  purchase_value numeric not null default 0,
  is_spark_ad boolean not null default false,
  spark_creator_username text,
  spark_video_id text,
  spark_video_url text,
  thumbnail_url text,
  platform text not null default 'tiktok',
  synced_at timestamptz not null default now(),
  primary key (ad_id, date)
);

create index if not exists tiktok_ad_insights_daily_date_idx
  on public.tiktok_ad_insights_daily (date desc);
create index if not exists tiktok_ad_insights_daily_campaign_id_idx
  on public.tiktok_ad_insights_daily (campaign_id);
create index if not exists tiktok_ad_insights_daily_spark_idx
  on public.tiktok_ad_insights_daily (is_spark_ad)
  where is_spark_ad = true;

alter table public.tiktok_ad_insights_daily enable row level security;

drop policy if exists "tiktok_ad_insights_daily_anon_read" on public.tiktok_ad_insights_daily;
drop policy if exists "tiktok_ad_insights_daily_anon_write" on public.tiktok_ad_insights_daily;

create policy "tiktok_ad_insights_daily_anon_read" on public.tiktok_ad_insights_daily
  for select using (true);
create policy "tiktok_ad_insights_daily_anon_write" on public.tiktok_ad_insights_daily
  for all using (true) with check (true);
