-- Transformation photos: a before/after content format.
-- Before photos are stored in the same deliveries table with is_before=true.
-- Creators dynamically pair any after delivery with any persona-matched before at export time.

alter table public.deliveries
  add column if not exists is_before boolean not null default false;

create index if not exists deliveries_persona_isbefore_idx
  on public.deliveries (persona, is_before);
