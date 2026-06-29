-- First-party SKAdNetwork / AdAttributionKit attribution ("DIY MMP").
--
-- Apple lets the advertised app receive its OWN copy of the winning postback by
-- declaring NSAdvertisingAttributionReportEndpoint (SKAN) and
-- AttributionCopyEndpoint (AdAttributionKit) in the iOS Info.plist. We point
-- both at our own collector (Next.js route in this app, served under /skan).
-- This file stands up the storage + decode config + the dashboard read views.
--
-- Design notes
-- ------------
-- * skan_postbacks is APPEND-ONLY raw audit + extracted/decoded columns. The raw
--   signed JSON is kept verbatim for re-decoding later if the CV schema / mapping
--   changes. It is RLS-locked (service-role only) because rows are device-grain;
--   the dashboard never reads it directly, only the aggregate views below.
-- * skan_cv_schema is OUR conversion-value -> event ladder (configured in Meta
--   Events Manager on 2026-06-23). The collector reads it to decode CV -> event.
--   Seeded below. Editable without code changes.
-- * skan_campaign_mapping maps the postback source-identifier (the value Meta
--   assigns) back to our named Meta campaign. Meta does NOT publish this mapping
--   cleanly, so it is best-effort and hand-maintained (see README). Left empty;
--   until populated, decoded events show as "unattributed" but still count.
-- * Views are owner-rights (NOT security_invoker) so anon can read AGGREGATES
--   through PostgREST without exposing raw postback rows.

-- ---------------------------------------------------------------------------
-- 1. Raw + decoded postback store (append-only audit)
-- ---------------------------------------------------------------------------
create table if not exists public.skan_postbacks (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  network text not null default 'skadnetwork',   -- 'skadnetwork' | 'adattributionkit'
  version text,                                   -- e.g. '4.0', '3.0'
  raw jsonb not null,                             -- full signed JSON exactly as received

  -- extracted fields (nullable: privacy thresholds null many of these out)
  ad_network_id text,
  source_identifier text,            -- SKAN4 source-identifier; for <4 we copy campaign-id here too
  campaign_id_raw text,              -- SKAN<4 campaign-id, when present
  app_id text,
  transaction_id text,               -- unique per postback; primary de-dupe key
  redownload boolean,
  did_win boolean,                   -- only count did-win = true (or null = single network)
  fidelity_type integer,             -- 0 = view-through, 1 = StoreKit-rendered click
  postback_sequence_index integer,   -- 0 = P1 (0-2d), 1 = P2 (3-7d), 2 = P3 (8-35d)
  conversion_value integer,          -- fine value 0-63 (P1) when above privacy threshold
  coarse_conversion_value text,      -- 'low' | 'medium' | 'high' (P2/P3)
  source_app_id text,
  source_domain text,

  -- verification
  signature_status text not null,    -- 'valid' | 'invalid' | 'unverified_aak' | 'unsupported_version' | 'error'

  -- decode results
  decoded_event text,                -- 'trial_started'|'subscribed'|'purchase'|'complete_registration'|null
  mapped_campaign_id text,           -- our Meta campaign id (best-effort)
  mapped_campaign_name text,
  decode_notes text,

  created_at timestamptz not null default now()
);

-- De-dupe: a device can resend the same window. Count once per
-- (network, transaction-id, window). transaction_id is unique per postback per
-- Apple's spec, so this is the natural idempotency key.
create unique index if not exists skan_postbacks_dedupe_idx
  on public.skan_postbacks (network, transaction_id, postback_sequence_index)
  where transaction_id is not null;

create index if not exists skan_postbacks_received_idx
  on public.skan_postbacks (received_at desc);
create index if not exists skan_postbacks_campaign_idx
  on public.skan_postbacks (mapped_campaign_id);
create index if not exists skan_postbacks_source_idx
  on public.skan_postbacks (source_identifier);

alter table public.skan_postbacks enable row level security;
-- Deny all anon/auth access; only the service role (collector) reads/writes rows.
drop policy if exists "skan_postbacks_no_anon" on public.skan_postbacks;
create policy "skan_postbacks_no_anon" on public.skan_postbacks
  for all using (false) with check (false);

-- ---------------------------------------------------------------------------
-- 2. Conversion-value -> event ladder (our SKAN 4.0 schema; editable)
-- ---------------------------------------------------------------------------
create table if not exists public.skan_cv_schema (
  id uuid primary key default gen_random_uuid(),
  postback_sequence_index integer not null,   -- 0 (P1), 1 (P2), 2 (P3)
  value_kind text not null,                    -- 'fine' | 'coarse'
  fine_value integer,                          -- 0..63 when value_kind = 'fine'
  coarse_value text,                           -- 'low'|'medium'|'high' when value_kind = 'coarse'
  event text not null,                         -- decoded event name
  note text,
  updated_at timestamptz not null default now()
);

-- One mapping per (window, value). Partial unique indexes because fine/coarse
-- use different columns and NULLs don't collide in a plain UNIQUE constraint.
create unique index if not exists skan_cv_schema_fine_idx
  on public.skan_cv_schema (postback_sequence_index, fine_value)
  where value_kind = 'fine';
create unique index if not exists skan_cv_schema_coarse_idx
  on public.skan_cv_schema (postback_sequence_index, coarse_value)
  where value_kind = 'coarse';

alter table public.skan_cv_schema enable row level security;
drop policy if exists "skan_cv_schema_anon_read" on public.skan_cv_schema;
drop policy if exists "skan_cv_schema_anon_write" on public.skan_cv_schema;
create policy "skan_cv_schema_anon_read" on public.skan_cv_schema for select using (true);
create policy "skan_cv_schema_anon_write" on public.skan_cv_schema for all using (true) with check (true);

-- Seed = the ladder applied in Meta Events Manager 2026-06-23.
-- Postback 1 (0-2d), fine values 60-63. Postback 2 (3-7d), coarse High/Med/Low.
-- (Values 0-59 in P1 are intentionally unmapped -> decoded_event = null.)
insert into public.skan_cv_schema (postback_sequence_index, value_kind, fine_value, coarse_value, event, note)
values
  (0, 'fine', 63, null, 'purchase',              'P1 fine: Purchase'),
  (0, 'fine', 62, null, 'subscribed',            'P1 fine: Subscribe (trial->paid)'),
  (0, 'fine', 61, null, 'trial_started',         'P1 fine: Start Trial'),
  (0, 'fine', 60, null, 'complete_registration', 'P1 fine: Complete registration'),
  (1, 'coarse', null, 'high',   'subscribed',            'P2 coarse High = day-7 trial->paid conversion'),
  (1, 'coarse', null, 'medium', 'trial_started',         'P2 coarse Medium = Start Trial'),
  (1, 'coarse', null, 'low',    'complete_registration', 'P2 coarse Low = Complete registration')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. source-identifier -> Meta campaign mapping (best-effort, hand-maintained)
-- ---------------------------------------------------------------------------
create table if not exists public.skan_campaign_mapping (
  id uuid primary key default gen_random_uuid(),
  network text not null default 'skadnetwork',
  source_identifier text not null,   -- value Meta sets (SKAN4 source-id, or SKAN<4 campaign-id)
  meta_campaign_id text,             -- our Meta campaign id (campaign under act_1575502753719515)
  meta_campaign_name text,
  note text,
  updated_at timestamptz not null default now()
);

create unique index if not exists skan_campaign_mapping_uniq_idx
  on public.skan_campaign_mapping (network, source_identifier);

alter table public.skan_campaign_mapping enable row level security;
drop policy if exists "skan_campaign_mapping_anon_read" on public.skan_campaign_mapping;
drop policy if exists "skan_campaign_mapping_anon_write" on public.skan_campaign_mapping;
create policy "skan_campaign_mapping_anon_read" on public.skan_campaign_mapping for select using (true);
create policy "skan_campaign_mapping_anon_write" on public.skan_campaign_mapping for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Per-campaign efficiency view (counts + spend join + cost-per)
-- ---------------------------------------------------------------------------
-- Only signature-valid, did-win postbacks with a decoded event are counted.
-- Window splits (P1/P2/P3) exposed as columns so the UI can break them down.
create or replace view public.skan_campaign_efficiency as
with ev as (
  select
    coalesce(mapped_campaign_id, 'src:' || source_identifier, 'unattributed') as campaign_key,
    mapped_campaign_id,
    max(mapped_campaign_name)                                                  as mapped_campaign_name,
    max(source_identifier)                                                     as source_identifier,
    count(*)                                                                   as postbacks,
    max(received_at)                                                           as last_postback_at,
    count(*) filter (where decoded_event = 'trial_started')                    as skan_trials,
    count(*) filter (where decoded_event = 'subscribed')                       as skan_subscribes,
    count(*) filter (where decoded_event = 'purchase')                         as skan_purchases,
    count(*) filter (where decoded_event = 'trial_started' and postback_sequence_index = 0) as trials_p1,
    count(*) filter (where decoded_event = 'trial_started' and postback_sequence_index = 1) as trials_p2,
    count(*) filter (where decoded_event = 'trial_started' and postback_sequence_index = 2) as trials_p3,
    count(*) filter (where decoded_event = 'subscribed'    and postback_sequence_index = 0) as subs_p1,
    count(*) filter (where decoded_event = 'subscribed'    and postback_sequence_index = 1) as subs_p2,
    count(*) filter (where decoded_event = 'subscribed'    and postback_sequence_index = 2) as subs_p3
  from public.skan_postbacks
  where signature_status = 'valid'
    and coalesce(did_win, true) = true
    and decoded_event is not null
  group by 1, 2
),
spend as (
  select campaign_id, sum(spend) as spend, max(campaign_name) as campaign_name
  from public.ad_insights_daily
  group by campaign_id
)
select
  ev.campaign_key,
  ev.mapped_campaign_id                                   as campaign_id,
  coalesce(ev.mapped_campaign_name, s.campaign_name)      as campaign_name,
  ev.source_identifier,
  ev.skan_trials,
  ev.skan_subscribes,
  ev.skan_purchases,
  ev.trials_p1, ev.trials_p2, ev.trials_p3,
  ev.subs_p1,   ev.subs_p2,   ev.subs_p3,
  s.spend,
  case when ev.skan_trials     > 0 then s.spend / ev.skan_trials     end as cost_per_skan_trial,
  case when ev.skan_subscribes > 0 then s.spend / ev.skan_subscribes end as cost_per_skan_subscribe,
  ev.postbacks,
  ev.last_postback_at
from ev
left join spend s on s.campaign_id = ev.mapped_campaign_id
order by s.spend desc nulls last, ev.skan_trials desc;

-- ---------------------------------------------------------------------------
-- 5. Reconciliation view (SKAN-derived totals vs RevenueCat source-of-truth)
-- ---------------------------------------------------------------------------
-- Blended CAC = Meta spend / RC trials is the causal-sanity number we trust most.
-- SKAN totals are accumulated (postbacks trickle in over 35d); spend/RC windowed
-- to 35d. The UI labels the window + the SKAN under-count variance explicitly.
create or replace view public.skan_reconciliation as
select
  (select coalesce(sum(skan_trials), 0)     from public.skan_campaign_efficiency)                                   as skan_trials,
  (select coalesce(sum(skan_subscribes), 0) from public.skan_campaign_efficiency)                                   as skan_subscribes,
  (select coalesce(sum(spend), 0)           from public.ad_insights_daily      where date >= current_date - 35)     as meta_spend_35d,
  (select coalesce(sum(trial_starts), 0)    from public.rc_account_metrics_daily where date >= current_date - 35)   as rc_trials_35d,
  (select coalesce(sum(trial_conversions),0) from public.rc_account_metrics_daily where date >= current_date - 35)  as rc_subscribes_35d,
  (select coalesce(sum(spend), 0)           from public.ad_insights_daily      where date >= current_date - 35)
    / nullif((select sum(trial_starts) from public.rc_account_metrics_daily where date >= current_date - 35), 0)    as blended_cac_35d;

-- Expose the aggregate views (NOT the raw table) to the dashboard's anon client.
grant select on public.skan_campaign_efficiency to anon, authenticated;
grant select on public.skan_reconciliation     to anon, authenticated;
