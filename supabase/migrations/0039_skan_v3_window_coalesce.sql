-- 0039: SKAN 3.0 postbacks carry no postback-sequence-index. The decode now
-- treats a missing index as 0 (see src/lib/skan/decode.ts). Mirror that in the
-- efficiency view's per-window split so 3.0 events land in the P1 columns
-- instead of vanishing (skan_trials/skan_subscribes already counted them —
-- only the *_p1/_p2/_p3 breakdown missed null-index rows).
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
    count(*) filter (where pb.decoded_event = 'trial_started' and coalesce(pb.postback_sequence_index,0) = 0) as trials_p1,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 1) as trials_p2,
    count(*) filter (where pb.decoded_event = 'trial_started' and pb.postback_sequence_index = 2) as trials_p3,
    count(*) filter (where pb.decoded_event = 'subscribed' and coalesce(pb.postback_sequence_index,0) = 0) as subs_p1,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 1) as subs_p2,
    count(*) filter (where pb.decoded_event = 'subscribed' and pb.postback_sequence_index = 2) as subs_p3
  from public.skan_postbacks pb
  left join public.skan_campaign_mapping m on m.network = pb.network and m.source_identifier = pb.source_identifier
  where pb.signature_status = 'valid' and coalesce(pb.did_win, true) = true and pb.decoded_event is not null
  group by 1, 2
),
spend as (
  select campaign_id, sum(spend) as spend, max(campaign_name) as campaign_name
  from public.ad_insights_daily where date >= (current_date - 35) group by campaign_id
)
select ev.campaign_key, ev.effective_campaign_id as campaign_id,
  coalesce(ev.mapped_campaign_name, s.campaign_name) as campaign_name,
  ev.source_identifier, ev.skan_trials, ev.skan_subscribes, ev.skan_purchases,
  ev.trials_p1, ev.trials_p2, ev.trials_p3, ev.subs_p1, ev.subs_p2, ev.subs_p3, s.spend,
  case when ev.skan_trials > 0 then s.spend / ev.skan_trials::numeric end as cost_per_skan_trial,
  case when ev.skan_subscribes > 0 then s.spend / ev.skan_subscribes::numeric end as cost_per_skan_subscribe,
  ev.postbacks, ev.last_postback_at
from ev left join spend s on s.campaign_id = ev.effective_campaign_id
order by s.spend desc nulls last, ev.skan_trials desc;
