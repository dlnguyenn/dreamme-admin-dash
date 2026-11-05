-- 0096: put skan_campaign_efficiency's postback counts on the same 35-day window as its spend.
--
-- 0037 bounded spend to the last 35 days but left the counts all-time, so cost_per_skan_trial
-- divided 35 days of spend by every trial ever received. SCALING iOS read $20.25 when the real
-- 35-day figure is $34.15, and the error grows the longer a campaign runs.
--
-- Same columns and types, so dependents keep working and inherit the window:
--   skan_reconciliation.skan_trials now compares like-for-like with rc_trials_35d.
--   campaign_ltv_cohorts now reads 35-day SKAN trials against its 35-day spend.
-- Campaigns with no decoded postback in the window drop out of the table.
-- Rollback: re-run this definition without the received_at line.

create or replace view public.skan_campaign_efficiency as
with ev as (
  select
    coalesce(pb.mapped_campaign_id, m.meta_campaign_id, 'src:' || pb.source_identifier, 'unattributed') as campaign_key,
    coalesce(pb.mapped_campaign_id, m.meta_campaign_id) as effective_campaign_id,
    max(coalesce(pb.mapped_campaign_name, m.meta_campaign_name)) as mapped_campaign_name,
    max(pb.source_identifier) as source_identifier,
    count(*) as postbacks,
    max(pb.received_at) as last_postback_at,
    count(*) filter (where pb.decoded_event = 'trial_started') as skan_trials,
    count(*) filter (where pb.decoded_event = 'subscribed') as skan_subscribes,
    count(*) filter (where pb.decoded_event = 'purchase') as skan_purchases,
    count(*) filter (where pb.decoded_event = 'trial_started' and coalesce(pb.postback_sequence_index, 0) = 0) as trials_p1,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 1) as trials_p2,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 2) as trials_p3,
    count(*) filter (where pb.decoded_event = 'subscribed' and coalesce(pb.postback_sequence_index, 0) = 0) as subs_p1,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 1) as subs_p2,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 2) as subs_p3
  from public.skan_postbacks pb
  left join public.skan_campaign_mapping m
    on m.network = pb.network and m.source_identifier = pb.source_identifier
  where pb.signature_status = 'valid'
    and coalesce(pb.did_win, true) = true
    and pb.decoded_event is not null
    and pb.received_at >= current_date - 35
  group by 1, 2
), spend as (
  select campaign_id, sum(spend) as spend, max(campaign_name) as campaign_name
  from public.ad_insights_daily
  where date >= current_date - 35
  group by campaign_id
)
select
  ev.campaign_key,
  ev.effective_campaign_id as campaign_id,
  coalesce(ev.mapped_campaign_name, s.campaign_name) as campaign_name,
  ev.source_identifier,
  ev.skan_trials,
  ev.skan_subscribes,
  ev.skan_purchases,
  ev.trials_p1,
  ev.trials_p2,
  ev.trials_p3,
  ev.subs_p1,
  ev.subs_p2,
  ev.subs_p3,
  s.spend,
  case when ev.skan_trials > 0 then s.spend / ev.skan_trials::numeric end as cost_per_skan_trial,
  case when ev.skan_subscribes > 0 then s.spend / ev.skan_subscribes::numeric end as cost_per_skan_subscribe,
  ev.postbacks,
  ev.last_postback_at
from ev
left join spend s on s.campaign_id = ev.effective_campaign_id
order by s.spend desc nulls last, ev.skan_trials desc;
