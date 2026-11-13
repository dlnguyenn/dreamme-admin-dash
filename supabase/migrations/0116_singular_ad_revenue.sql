-- 0116: money per Meta ad, from Singular.
--
-- RevenueCat's Singular integration (live 2026-11-05) sends purchases, trial
-- conversions and renewals with gross revenue. Singular ties each to the
-- install it attributed, so its `revenue` cohort metric per ad is the money
-- each Meta ad's installs brought in. The ad sync now stores it over the
-- conversion period (14d, the same window as paid_conversions) and over 30d.
--
-- mmp_ad_money reads only installs from 2026-10-30 on. Payments made before
-- the integration went live (2026-11-05) never reached Singular. A trial
-- converts about 7 days after install, so installs from about Oct 29 on had
-- their first payment after that; Oct 30 keeps a day's margin. (Direct
-- purchases with no trial on install days before Nov 5 are missed; on iOS
-- nearly every first purchase is a trial.) "Mature" means old enough for the window to have closed, so the
-- numbers stop moving; spend is Meta's for the same install days.

alter table public.singular_ad_daily
  add column if not exists revenue numeric not null default 0,
  add column if not exists revenue_30d numeric not null default 0;

create or replace view public.mmp_ad_money as
with win as (
  select
    date '2026-10-30' as floor_date,
    coalesce(max(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int), 14) as conv_days
  from public.singular_ad_daily
  where conversion_period is not null and date >= current_date - 35
),
sng as (
  select
    campaign_id, max(campaign_name) as campaign_name,
    adset_id, max(adset_name) as adset_name,
    ad_id, max(ad_name) as ad_name,
    sum(trial_starts) as trials_since,
    sum(paid_conversions) as paid_since,
    sum(revenue) as revenue_since,
    sum(trial_starts) filter (where date <= current_date - w.conv_days) as trials_mature,
    sum(paid_conversions) filter (where date <= current_date - w.conv_days) as paid_mature,
    sum(revenue) filter (where date <= current_date - w.conv_days) as revenue_mature,
    sum(trial_starts) filter (where date <= current_date - 30) as trials_mature_30d,
    sum(revenue_30d) filter (where date <= current_date - 30) as revenue_mature_30d
  from public.singular_ad_daily, win w
  where source = 'facebook' and date >= w.floor_date
  group by campaign_id, adset_id, ad_id
),
meta as (
  select
    campaign_id, max(campaign_name) as campaign_name,
    adset_id, max(adset_name) as adset_name,
    ad_id, max(ad_name) as ad_name,
    sum(spend) as spend_since,
    sum(spend) filter (where date <= current_date - w.conv_days) as spend_mature,
    sum(spend) filter (where date <= current_date - 30) as spend_mature_30d
  from public.ad_insights_daily, win w
  where date >= w.floor_date
  group by campaign_id, adset_id, ad_id
)
select
  coalesce(m.campaign_id, s.campaign_id) as campaign_id,
  coalesce(m.campaign_name, s.campaign_name) as campaign_name,
  coalesce(m.adset_id, nullif(s.adset_id, '')) as adset_id,
  coalesce(m.adset_name, s.adset_name) as adset_name,
  coalesce(m.ad_id, nullif(s.ad_id, '')) as ad_id,
  coalesce(m.ad_name, s.ad_name) as ad_name,
  (select floor_date from win) as floor_date,
  (select conv_days from win) as conv_days,
  coalesce(m.spend_since, 0) as spend_since,
  coalesce(s.trials_since, 0) as trials_since,
  coalesce(s.paid_since, 0) as paid_since,
  coalesce(s.revenue_since, 0) as revenue_since,
  coalesce(m.spend_mature, 0) as spend_mature,
  coalesce(s.trials_mature, 0) as trials_mature,
  coalesce(s.paid_mature, 0) as paid_mature,
  coalesce(s.revenue_mature, 0) as revenue_mature,
  coalesce(m.spend_mature_30d, 0) as spend_mature_30d,
  coalesce(s.trials_mature_30d, 0) as trials_mature_30d,
  coalesce(s.revenue_mature_30d, 0) as revenue_mature_30d
from meta m
full join sng s
  on s.campaign_id = m.campaign_id and s.adset_id = m.adset_id and s.ad_id = m.ad_id
where coalesce(m.spend_since, 0) > 0 or coalesce(s.trials_since, 0) > 0
order by coalesce(m.spend_since, 0) desc;

revoke all on public.mmp_ad_money from anon, authenticated;
grant select on public.mmp_ad_money to service_role;
