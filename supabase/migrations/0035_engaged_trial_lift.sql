-- Module 3 — Engaged-trial conversion-value modeling.
--
-- Encode a first-24h engagement signal (logged weight/meal/dose) as a distinct,
-- higher-quality SKAN event 'trial_engaged' so Meta's optimizer gets a better
-- signal than a noisy "any trial". Meta-managed CV: the iOS app fires a
-- 'trial_engaged' Facebook event (driven by an n8n 24h pass), Meta assigns it a
-- fine value in its SKAN ladder, and our collector decodes that value via this
-- schema row — no collector code change.
--
-- Pick fine value 59 (just below complete_registration=60; 60-63 already used).
-- Dan must configure Meta Events Manager to assign 'trial_engaged' -> 59 in the
-- SKAN conversion-value ladder so what Meta sends matches what we decode here.

insert into public.skan_cv_schema (postback_sequence_index, value_kind, fine_value, coarse_value, event, note)
values (0, 'fine', 59, null, 'trial_engaged', 'P1 fine: engaged trial (logged weight/meal/dose <24h) — configure 59 in Meta Events Manager')
on conflict do nothing;

-- Per-campaign engaged-trial lift: how big a share of a campaign's trials engage
-- in the first 24h, vs its subscribe rate. trial_started and trial_engaged are
-- mutually exclusive per postback (Meta sets one CV), so trials_total = both.
-- Cohort-level (SKAN is anonymous) — directional, not per-user. Empty until
-- postbacks flow + Meta Events Manager assigns the 59 value.
create or replace view public.engaged_trial_lift as
with ev as (
  select
    coalesce(mapped_campaign_id, 'src:' || source_identifier, 'unattributed') as campaign_key,
    mapped_campaign_id,
    max(mapped_campaign_name)                                    as campaign_name,
    count(*) filter (where decoded_event = 'trial_started')      as trials_plain,
    count(*) filter (where decoded_event = 'trial_engaged')      as trials_engaged,
    count(*) filter (where decoded_event = 'subscribed')         as subscribes,
    max(received_at)                                             as last_postback_at
  from public.skan_postbacks
  where signature_status = 'valid'
    and coalesce(did_win, true) = true
    and decoded_event is not null
  group by 1, 2
)
select
  campaign_key,
  mapped_campaign_id as campaign_id,
  campaign_name,
  trials_plain,
  trials_engaged,
  (trials_plain + trials_engaged)                                             as trials_total,
  subscribes,
  case when (trials_plain + trials_engaged) > 0
       then trials_engaged::numeric / (trials_plain + trials_engaged) end     as engaged_share,
  case when (trials_plain + trials_engaged) > 0
       then subscribes::numeric / (trials_plain + trials_engaged) end         as subscribe_rate,
  last_postback_at
from ev
order by (trials_plain + trials_engaged) desc, subscribes desc;

grant select on public.engaged_trial_lift to anon, authenticated;
