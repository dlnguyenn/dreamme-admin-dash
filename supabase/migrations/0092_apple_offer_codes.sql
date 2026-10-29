-- Support Inbox "Offer codes" sub tab: one-time-use App Store offer codes
-- (Yearly Special, $39.99/yr) that Dan hands to iPhone users who ask for a
-- discount. Rows are imported from App Store Connect's CSV export by hand
-- (never committed: each code is redeemable once by whoever holds it).
--
-- "Used" = assigned to someone (used_at set). Claiming from a thread goes
-- through claim_apple_offer_code(), which is idempotent per thread and takes
-- the next free code under FOR UPDATE SKIP LOCKED, so two clicks or two tabs
-- can never hand out the same code.
create table if not exists public.apple_offer_codes (
  code text primary key,
  redeem_url text not null,
  offer_name text not null default 'Yearly Special',
  batch text,                           -- the ASC export it came from
  position integer not null,            -- order in the export, low first
  used_at timestamptz,
  thread_id uuid references public.support_threads(id) on delete set null,
  used_by_email text,
  used_by_name text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists apple_offer_codes_free_idx
  on public.apple_offer_codes (offer_name, position) where used_at is null;
create index if not exists apple_offer_codes_thread_idx
  on public.apple_offer_codes (thread_id);

comment on table public.apple_offer_codes is
  'DAD Support Inbox one-time App Store offer codes; service-role only.';

alter table public.apple_offer_codes enable row level security;
-- service-role only.

create or replace function public.claim_apple_offer_code(
  p_thread_id uuid,
  p_email text,
  p_name text,
  p_offer_name text default 'Yearly Special'
) returns setof public.apple_offer_codes
language plpgsql
as $$
declare
  existing public.apple_offer_codes;
begin
  select * into existing from public.apple_offer_codes
   where thread_id = p_thread_id and offer_name = p_offer_name
   order by used_at desc limit 1;
  if found then
    return next existing;
    return;
  end if;

  return query
  update public.apple_offer_codes c
     set used_at = now(),
         thread_id = p_thread_id,
         used_by_email = p_email,
         used_by_name = p_name
   where c.code = (
     select code from public.apple_offer_codes
      where used_at is null and offer_name = p_offer_name
      order by position
      limit 1
      for update skip locked
   )
  returning c.*;
end;
$$;

revoke execute on function public.claim_apple_offer_code(uuid, text, text, text)
  from public, anon, authenticated;
