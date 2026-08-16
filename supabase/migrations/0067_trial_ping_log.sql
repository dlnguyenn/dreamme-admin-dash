-- 0067: trial_ping_log — server-side idempotency ledger for trial-quality pings.
--
-- WHY: the n8n instance behind n8n.dreammeops.us died ~2026-07-06 (Cloudflare
-- tunnel origin unreachable) and with it the workflow that silent-pushed
-- devices at +2h (trial_qualified) and +24h (trial_engaged) after each trial
-- start. Those pushes are what make the app fire the trial-quality events to
-- the Meta SDK and Singular. Replacement lives in this repo:
-- /api/cron/trial-pings, triggered every 15 min by GitHub Actions
-- (.github/workflows/trial-pings.yml) because Vercel Hobby crons are
-- daily-only.
--
-- THE LEDGER IS THE CORRECTNESS CORE. The route claims (original_transaction_id,
-- ping_type) here with ON CONFLICT DO NOTHING before sending anything; only
-- rows it successfully claimed get a push. Wide catch-up windows (4h) mean the
-- same trial is seen by many consecutive runs — the PK is what guarantees at
-- most one push per trial per ping type, even across crashed or concurrent
-- runs. The app keeps its own AsyncStorage ledger + willRenew re-check as a
-- second layer; this table is the server-side first layer.

create table if not exists public.trial_ping_log (
  original_transaction_id text        not null,
  ping_type               text        not null
    check (ping_type in ('trial_qualified', 'trial_engaged')),
  app_user_id             text        not null,
  product_id              text,
  price_usd               numeric,
  claimed_at              timestamptz not null default now(),
  -- Expo's per-message ticket outcome: 'ok', 'error:DeviceNotRegistered',
  -- 'no_token' (user had no push token), etc. Null = claimed but send did not
  -- complete (crash window) — visible, not silently lost.
  expo_status             text,
  expo_detail             text,
  primary key (original_transaction_id, ping_type)
);

create index if not exists trial_ping_log_claimed_idx
  on public.trial_ping_log (claimed_at desc);

alter table public.trial_ping_log enable row level security;

drop policy if exists "trial_ping_log_anon_read"  on public.trial_ping_log;
drop policy if exists "trial_ping_log_anon_write" on public.trial_ping_log;

create policy "trial_ping_log_anon_read" on public.trial_ping_log
  for select using (true);
create policy "trial_ping_log_anon_write" on public.trial_ping_log
  for all using (true) with check (true);
