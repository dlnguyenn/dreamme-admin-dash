-- Module 2 — LTV / Retention Cohorts by Acquisition Source.
--
-- Ranks campaigns by predicted LTV per trial (trial->paid rate x LTV per payer),
-- built on data that exists TODAY and auto-enriching as better signal arrives.
--
-- The view is SPEND-DRIVEN (one row per campaign with spend in the last 35d) so
-- it is never empty, and it ladders the trial->paid signal by quality:
--   rc_actual    — per-ad RC attribution WITH conversion signal (best)
--   skan_proxy   — SKAN P2 coarse High = day-7 trial->paid (subs_p2 / trials_p1)
--   account_blended — account-level trial_conversion_rate (fallback)
-- A source is only used when it actually carries conversion signal (conv > 0 /
-- subs_p2 > 0); rc_ad_metrics_daily currently has trial STARTS but 0 conversions,
-- so trusting its 0 would understate every campaign — we fall back instead. When
-- per-ad conversions/LTV start flowing, rows flip to rc_actual with NO code change.
--
-- Honesty note: per-campaign trial COUNTS are an attributed subset (network ~4.5%,
-- RC-attributed ~ATT slice) — NOT complete. Use this to RANK acquisition sources by
-- predicted LTV; use the blended CAC (Module 1 / skan_reconciliation) for absolute cost.

create or replace view public.campaign_ltv_cohorts as
with spend as (
  select campaign_id as cid, max(campaign_name) as campaign_name,
         sum(spend) as spend, sum(trial_starts) as network_trials
  from public.cross_network_cost_daily
  where date >= current_date - 35
  group by campaign_id
),
skan as (
  select campaign_id as cid, trials_p1, subs_p2
  from public.skan_campaign_efficiency
  where campaign_id is not null
),
rc_ad as (
  select ai.campaign_id as cid,
         sum(r.trial_starts)        as trials,
         sum(r.trial_conversions)   as conv,
         avg(nullif(r.ltv_30d, 0))  as ltv30
  from public.rc_ad_metrics_daily r
  join public.ad_insights_daily ai on ai.ad_id = r.ad_id
  where r.date >= current_date - 35
  group by ai.campaign_id
),
acct as (
  select
    avg(ltv_30d_per_paying_customer) filter (where ltv_30d_per_paying_customer is not null) as ltv30,
    case when sum(trial_starts) > 0 then sum(trial_conversions)::numeric / sum(trial_starts) end as trial_to_paid
  from public.rc_account_metrics_daily
  where date >= current_date - 30
)
select
  sp.cid                                                            as campaign_id,
  sp.campaign_name,
  sp.spend,
  -- best per-campaign trial count available (RC-attributed > SKAN P1 > network)
  coalesce(ra.trials, sk.trials_p1, sp.network_trials)             as trials,
  -- trial->paid rate, only from a source that carries conversion signal
  coalesce(
    case when ra.trials > 0 and ra.conv > 0 then ra.conv::numeric / ra.trials end,
    case when sk.trials_p1 > 0 and sk.subs_p2 > 0 then sk.subs_p2::numeric / sk.trials_p1 end,
    acct.trial_to_paid
  )                                                                as trial_to_paid,
  coalesce(ra.ltv30, acct.ltv30)                                   as ltv_per_payer,
  -- predicted value created per trial started
  coalesce(
    case when ra.trials > 0 and ra.conv > 0 then ra.conv::numeric / ra.trials end,
    case when sk.trials_p1 > 0 and sk.subs_p2 > 0 then sk.subs_p2::numeric / sk.trials_p1 end,
    acct.trial_to_paid
  ) * coalesce(ra.ltv30, acct.ltv30)                               as predicted_ltv_per_trial,
  -- per-campaign cost per (attributed) trial — directional, attributed-subset only
  case when coalesce(ra.trials, sk.trials_p1, sp.network_trials) > 0
       then sp.spend / coalesce(ra.trials, sk.trials_p1, sp.network_trials) end as cost_per_trial,
  -- which signal the trial->paid rate came from
  case
    when ra.trials > 0 and ra.conv > 0 then 'rc_actual'
    when sk.trials_p1 > 0 and sk.subs_p2 > 0 then 'skan_proxy'
    else 'account_blended'
  end                                                              as source
from spend sp
left join skan sk on sk.cid = sp.cid
left join rc_ad ra on ra.cid = sp.cid
cross join acct
order by
  coalesce(
    case when ra.trials > 0 and ra.conv > 0 then ra.conv::numeric / ra.trials end,
    case when sk.trials_p1 > 0 and sk.subs_p2 > 0 then sk.subs_p2::numeric / sk.trials_p1 end,
    acct.trial_to_paid
  ) * coalesce(ra.ltv30, acct.ltv30) desc nulls last;

grant select on public.campaign_ltv_cohorts to anon, authenticated;
