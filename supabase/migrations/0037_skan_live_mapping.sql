-- 0037: SKAN views — live mapping join + bounded spend window.
--
-- Fix 1 (retro-attribution): postbacks are stamped with mapped_campaign_id at
-- INSERT time (lib/skan/handler.ts), but skan_campaign_mapping is populated
-- FROM observed postbacks — so the first postbacks always arrive before their
-- mapping row exists and would stay "unattributed" forever. Redefine the views
-- to LEFT JOIN skan_campaign_mapping live and COALESCE with the stamped value,
-- so inserting a mapping row retroactively attributes everything.
--
-- Fix 2 (spend window): the spend CTE summed ALL-TIME ad_insights_daily spend
-- per campaign while postbacks only accrue from ~2026-07-04 → cost_per_skan_*
-- would divide months of spend by days of postbacks. Bound spend to the last
-- 35 days (= SKAN's max postback-3 window, and the house convention used by
-- skan_reconciliation / cross_network_*).

create or replace view public.skan_campaign_efficiency as
with ev as (
  select
    coalesce(
      pb.mapped_campaign_id,
      m.meta_campaign_id,
      'src:' || pb.source_identifier,
      'unattributed'
    ) as campaign_key,
    coalesce(pb.mapped_campaign_id, m.meta_campaign_id) as effective_campaign_id,
    max(coalesce(pb.mapped_campaign_name, m.meta_campaign_name)) as mapped_campaign_name,
    max(pb.source_identifier) as source_identifier,
    count(*) as postbacks,
    max(pb.received_at) as last_postback_at,
    count(*) filter (where pb.decoded_event = 'trial_started') as skan_trials,
    count(*) filter (where pb.decoded_event = 'subscribed') as skan_subscribes,
    count(*) filter (where pb.decoded_event = 'purchase') as skan_purchases,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 0) as trials_p1,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 1) as trials_p2,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 2) as trials_p3,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 0) as subs_p1,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 1) as subs_p2,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 2) as subs_p3
  from public.skan_postbacks pb
  left join public.skan_campaign_mapping m
    on m.network = pb.network
   and m.source_identifier = pb.source_identifier
  where pb.signature_status = 'valid'
    and coalesce(pb.did_win, true) = true
    and pb.decoded_event is not null
  group by 1, 2
),
spend as (
  select
    campaign_id,
    sum(spend) as spend,
    max(campaign_name) as campaign_name
  from public.ad_insights_daily
  where date >= (current_date - 35)
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

create or replace view public.engaged_trial_lift as
with ev as (
  select
    coalesce(
      pb.mapped_campaign_id,
      m.meta_campaign_id,
      'src:' || pb.source_identifier,
      'unattributed'
    ) as campaign_key,
    coalesce(pb.mapped_campaign_id, m.meta_campaign_id) as effective_campaign_id,
    max(coalesce(pb.mapped_campaign_name, m.meta_campaign_name)) as campaign_name,
    count(*) filter (where pb.decoded_event = 'trial_started') as trials_plain,
    count(*) filter (where pb.decoded_event = 'trial_engaged') as trials_engaged,
    count(*) filter (where pb.decoded_event = 'subscribed') as subscribes,
    max(pb.received_at) as last_postback_at
  from public.skan_postbacks pb
  left join public.skan_campaign_mapping m
    on m.network = pb.network
   and m.source_identifier = pb.source_identifier
  where pb.signature_status = 'valid'
    and coalesce(pb.did_win, true) = true
    and pb.decoded_event is not null
  group by 1, 2
)
select
  campaign_key,
  effective_campaign_id as campaign_id,
  campaign_name,
  trials_plain,
  trials_engaged,
  trials_plain + trials_engaged as trials_total,
  subscribes,
  case when (trials_plain + trials_engaged) > 0
    then trials_engaged::numeric / (trials_plain + trials_engaged)::numeric end as engaged_share,
  case when (trials_plain + trials_engaged) > 0
    then subscribes::numeric / (trials_plain + trials_engaged)::numeric end as subscribe_rate,
  last_postback_at
from ev
order by (trials_plain + trials_engaged) desc, subscribes desc;
