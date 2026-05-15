-- Creative-analytics dashboard: daily Meta ad insights + n8n qualified-trial counts.
-- Read-only analytics surface at /creatives; two cron jobs upsert into these tables.

create table if not exists public.ad_insights_daily (
  ad_id text not null,
  date date not null,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  status text,
  effective_status text,
  spend numeric not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  unique_clicks integer not null default 0,
  ctr numeric,
  cpm numeric,
  installs integer not null default 0,
  trial_starts integer not null default 0,
  purchases integer not null default 0,
  purchase_value numeric not null default 0,
  creative_id text,
  creative_name text,
  thumbnail_url text,
  image_url text,
  video_id text,
  message text,
  headline text,
  synced_at timestamptz not null default now(),
  primary key (ad_id, date)
);

create index if not exists ad_insights_daily_date_idx
  on public.ad_insights_daily (date desc);
create index if not exists ad_insights_daily_campaign_id_idx
  on public.ad_insights_daily (campaign_id);

alter table public.ad_insights_daily enable row level security;

drop policy if exists "ad_insights_daily_anon_read" on public.ad_insights_daily;
drop policy if exists "ad_insights_daily_anon_write" on public.ad_insights_daily;

create policy "ad_insights_daily_anon_read" on public.ad_insights_daily
  for select using (true);
create policy "ad_insights_daily_anon_write" on public.ad_insights_daily
  for all using (true) with check (true);


create table if not exists public.qualified_trials_daily (
  date date primary key,
  count integer not null,
  source text not null default 'n8n_workflow_wEZAcV8qNd0OTUBQ',
  synced_at timestamptz not null default now()
);

alter table public.qualified_trials_daily enable row level security;

drop policy if exists "qualified_trials_daily_anon_read" on public.qualified_trials_daily;
drop policy if exists "qualified_trials_daily_anon_write" on public.qualified_trials_daily;

create policy "qualified_trials_daily_anon_read" on public.qualified_trials_daily
  for select using (true);
create policy "qualified_trials_daily_anon_write" on public.qualified_trials_daily
  for all using (true) with check (true);
