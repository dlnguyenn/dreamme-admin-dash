-- Errors tab: DreamMe's own error tracker, in place of sentry.io.
--
-- The app keeps the @sentry/react-native SDK and points its DSN at the DAD.
-- /api/errors/envelope (rewritten from /api/<project>/envelope/) parses the
-- SDK's envelopes and calls err_ingest() once per error event. Only error
-- events are stored; transactions, replays, sessions and profiles are
-- acknowledged and dropped. See src/lib/errors/ and docs/error-tracker.md.
--
-- Every table is service-role only, and err_ingest() is not callable with the
-- anon key (it is in the page bundle). Re-applying this file is safe.

-- One row per issue (a group of events with the same fingerprint).
create table if not exists public.err_issues (
  id bigint generated always as identity primary key,
  fingerprint text not null unique,
  -- Bump in src/lib/errors/event.ts when the grouping rules change, so old
  -- issues can be told apart (and regrouped) later.
  grouping_version integer not null default 1,
  platform text,
  level text,
  type text,
  value text,
  title text not null,
  culprit text,
  mechanism text,
  handled boolean,
  status text not null default 'unresolved' check (status in ('unresolved', 'resolved', 'ignored')),
  status_changed_at timestamptz,
  status_changed_by text,
  -- Set when a resolved issue sees a new event (it then goes back to unresolved).
  regressed_at timestamptz,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  first_release text,
  last_release text,
  event_count bigint not null default 0,
  user_count integer not null default 0,
  sample_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists err_issues_last_seen_idx on public.err_issues (last_seen desc);
create index if not exists err_issues_status_idx on public.err_issues (status, last_seen desc);

comment on table public.err_issues is
  'DAD Errors tab: one row per grouped app error (Sentry-compatible ingest). Service-role only.';

-- A few full (scrubbed) events per issue, for the stack trace, breadcrumbs
-- and device context. symbolicated holds frames resolved through a source map
-- the first time someone opens the event, so each map is parsed once.
create table if not exists public.err_events (
  event_id text primary key,
  issue_id bigint not null references public.err_issues (id) on delete cascade,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  release text,
  dist text,
  environment text,
  platform text,
  os text,
  device text,
  user_id text,
  payload jsonb not null,
  symbolicated jsonb,
  symbolicated_at timestamptz
);

create index if not exists err_events_issue_idx on public.err_events (issue_id, occurred_at desc);

comment on table public.err_events is
  'DAD Errors tab: sample events per issue, scrubbed on ingest (allowlist). Service-role only.';

-- Events per issue per day per release, for sparklines, spikes and release splits.
create table if not exists public.err_issue_daily (
  issue_id bigint not null references public.err_issues (id) on delete cascade,
  day date not null,
  release text not null default '',
  events integer not null default 0,
  primary key (issue_id, day, release)
);

create index if not exists err_issue_daily_day_idx on public.err_issue_daily (day);

-- Distinct users per issue. user_key is a hash (of the app user id, or the
-- device hash for signed-out users), never the id itself.
create table if not exists public.err_issue_users (
  issue_id bigint not null references public.err_issues (id) on delete cascade,
  user_key text not null,
  first_seen timestamptz not null default now(),
  primary key (issue_id, user_key)
);

-- Event ids seen in the last few days. The SDKs resend cached envelopes, so
-- this keeps a retry from counting twice. Pruned by err_prune().
create table if not exists public.err_seen (
  event_id text primary key,
  seen_at timestamptz not null default now()
);

-- Events accepted per minute, for the global cap in err_ingest().
create table if not exists public.err_ingest_minute (
  minute timestamptz primary key,
  events integer not null default 0
);

-- Uploaded source maps. The file itself is in the private storage bucket
-- error-sourcemaps at storage_path (gzipped).
create table if not exists public.err_sourcemaps (
  id bigint generated always as identity primary key,
  debug_id text,
  release text,
  dist text,
  bundle text,
  storage_path text not null unique,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

create index if not exists err_sourcemaps_debug_idx on public.err_sourcemaps (debug_id);
create index if not exists err_sourcemaps_release_idx on public.err_sourcemaps (release, dist, bundle);

insert into storage.buckets (id, name, public)
values ('error-sourcemaps', 'error-sourcemaps', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- err_ingest(e): record one error event. e is built by src/lib/errors/event.ts:
--   event_id, fingerprint, grouping_version, platform, level, type, value,
--   title, culprit, mechanism, handled, occurred_at, release, dist,
--   environment, os, device, user_id, user_key, payload
-- plus p_cap (max events a minute across everything) and p_samples (max
-- stored samples per issue). Returns {status, issue_id, new_issue, stored}.
-- status: ok | duplicate | rate_limited.

create or replace function public.err_ingest(e jsonb, p_cap integer default 300, p_samples integer default 15)
returns jsonb
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_at timestamptz := least(coalesce((e->>'occurred_at')::timestamptz, v_now), v_now);
  v_release text := coalesce(e->>'release', '');
  v_minute integer;
  v_issue public.err_issues%rowtype;
  v_new boolean := false;
  v_stored boolean := false;
  v_release_has_sample boolean;
begin
  insert into public.err_seen (event_id) values (e->>'event_id') on conflict do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.err_ingest_minute as m (minute, events)
  values (date_trunc('minute', v_now), 1)
  on conflict (minute) do update set events = m.events + 1
  returning events into v_minute;
  if v_minute > p_cap then
    -- Forget the id so the SDK's retry after Retry-After is accepted.
    delete from public.err_seen where event_id = e->>'event_id';
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.err_issues as i (
    fingerprint, grouping_version, platform, level, type, value, title, culprit,
    mechanism, handled, first_seen, last_seen, first_release, last_release, event_count
  ) values (
    e->>'fingerprint', coalesce((e->>'grouping_version')::int, 1), e->>'platform', e->>'level',
    e->>'type', e->>'value', coalesce(e->>'title', '(no title)'), e->>'culprit',
    e->>'mechanism', (e->>'handled')::boolean, v_at, v_at, nullif(v_release, ''), nullif(v_release, ''), 1
  )
  on conflict (fingerprint) do update set
    event_count = i.event_count + 1,
    last_seen = greatest(i.last_seen, excluded.last_seen),
    first_seen = least(i.first_seen, excluded.first_seen),
    last_release = case when excluded.last_seen >= i.last_seen then coalesce(excluded.last_release, i.last_release) else i.last_release end,
    first_release = coalesce(i.first_release, excluded.first_release),
    level = excluded.level,
    culprit = coalesce(i.culprit, excluded.culprit),
    status = case when i.status = 'resolved' then 'unresolved' else i.status end,
    regressed_at = case when i.status = 'resolved' then v_now else i.regressed_at end,
    status_changed_at = case when i.status = 'resolved' then v_now else i.status_changed_at end,
    status_changed_by = case when i.status = 'resolved' then 'regression' else i.status_changed_by end
  returning * into v_issue;

  v_new := v_issue.event_count = 1;

  if coalesce(e->>'user_key', '') <> '' then
    insert into public.err_issue_users (issue_id, user_key) values (v_issue.id, e->>'user_key')
    on conflict do nothing;
    if found then
      update public.err_issues set user_count = user_count + 1 where id = v_issue.id;
    end if;
  end if;

  insert into public.err_issue_daily as d (issue_id, day, release, events)
  values (v_issue.id, (v_at at time zone 'UTC')::date, v_release, 1)
  on conflict (issue_id, day, release) do update set events = d.events + 1;

  -- Keep the first p_samples events, plus the first one from every release.
  select exists (
    select 1 from public.err_events where issue_id = v_issue.id and coalesce(release, '') = v_release
  ) into v_release_has_sample;

  if v_issue.sample_count < p_samples or not v_release_has_sample then
    insert into public.err_events (
      event_id, issue_id, occurred_at, release, dist, environment, platform, os, device, user_id, payload
    ) values (
      e->>'event_id', v_issue.id, v_at, nullif(v_release, ''), e->>'dist', e->>'environment',
      e->>'platform', e->>'os', e->>'device', e->>'user_id', coalesce(e->'payload', '{}'::jsonb)
    ) on conflict (event_id) do nothing;
    if found then
      update public.err_issues set sample_count = sample_count + 1 where id = v_issue.id;
      v_stored := true;
    end if;
  end if;

  return jsonb_build_object('status', 'ok', 'issue_id', v_issue.id, 'new_issue', v_new, 'stored', v_stored);
end;
$$;

-- Daily cleanup: dedupe ids after 3 days, minute counters after a day,
-- samples after 60 days (always keeping each issue's 3 newest).
create or replace function public.err_prune()
returns void
language plpgsql
as $$
begin
  delete from public.err_seen where seen_at < now() - interval '3 days';
  delete from public.err_ingest_minute where minute < now() - interval '1 day';
  delete from public.err_events ev
  where ev.occurred_at < now() - interval '60 days'
    and ev.event_id not in (
      select event_id from (
        select event_id, row_number() over (partition by issue_id order by occurred_at desc) as rn
        from public.err_events
      ) ranked where rn <= 3
    );
  update public.err_issues i
     set sample_count = (select count(*) from public.err_events ev where ev.issue_id = i.id)
   where i.sample_count <> (select count(*) from public.err_events ev where ev.issue_id = i.id);
end;
$$;

alter table public.err_issues enable row level security;
alter table public.err_events enable row level security;
alter table public.err_issue_daily enable row level security;
alter table public.err_issue_users enable row level security;
alter table public.err_seen enable row level security;
alter table public.err_ingest_minute enable row level security;
alter table public.err_sourcemaps enable row level security;
revoke all on public.err_issues from anon, authenticated;
revoke all on public.err_events from anon, authenticated;
revoke all on public.err_issue_daily from anon, authenticated;
revoke all on public.err_issue_users from anon, authenticated;
revoke all on public.err_seen from anon, authenticated;
revoke all on public.err_ingest_minute from anon, authenticated;
revoke all on public.err_sourcemaps from anon, authenticated;
revoke all on function public.err_ingest(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.err_prune() from public, anon, authenticated;
grant execute on function public.err_ingest(jsonb, integer, integer) to service_role;
grant execute on function public.err_prune() to service_role;

-- cron.schedule upserts by jobname, so re-applying this file is safe.
select cron.schedule('err-prune', '17 4 * * *', 'select public.err_prune()');
