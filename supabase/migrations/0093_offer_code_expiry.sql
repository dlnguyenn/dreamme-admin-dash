-- One-time App Store offer code batches expire (ASC expirationDate). The
-- first Yearly batch loaded here (482615) had already expired on 2026-09-28,
-- and one of its codes went out to a customer before anyone noticed.
-- Store the date per code and never hand out an expired one: a thread whose
-- code has expired gets a fresh code on the next claim.
alter table public.apple_offer_codes
  add column if not exists expires_on date;

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
     and (expires_on is null or expires_on >= current_date)
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
        and (expires_on is null or expires_on >= current_date)
      order by position
      limit 1
      for update skip locked
   )
  returning c.*;
end;
$$;

revoke execute on function public.claim_apple_offer_code(uuid, text, text, text)
  from public, anon, authenticated;
