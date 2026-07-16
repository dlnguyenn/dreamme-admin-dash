-- Competitor ads tagged with OUR creative taxonomy (shared vocabulary with
-- ad_creative_tags so their ads and ours can be compared directly) plus the
-- winner signals the Apify Ad Library provider exposes. Additive only — the
-- dash's competitor code selects existing columns and is unaffected.

alter table public.competitor_ads
  add column if not exists visual_format text,      -- VISUAL_FORMATS enum (app-enforced)
  add column if not exists messaging_theme text,    -- registry-controlled Title Case label
  add column if not exists theme_description text,
  add column if not exists impressions_index int,   -- Meta's bucketed impressions index
  add column if not exists collation_count int,     -- collapsed variant count (spend proxy)
  add column if not exists total_active_time int;   -- seconds active, per Ad Library

create index if not exists competitor_ads_taxonomy_idx
  on public.competitor_ads (messaging_theme, visual_format);
