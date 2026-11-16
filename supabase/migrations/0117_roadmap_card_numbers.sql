-- Every Roadmap card gets a short number (#1, #2, ...) people can say out
-- loud instead of a uuid. Existing cards are numbered oldest first; new cards
-- take the next number from a sequence. Numbers never change or get reused.
alter table public.roadmap_items add column if not exists num integer;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.roadmap_items
)
update public.roadmap_items r
   set num = o.rn
  from ordered o
 where r.id = o.id
   and r.num is null;

create sequence if not exists public.roadmap_items_num_seq
  owned by public.roadmap_items.num;

select setval(
  'public.roadmap_items_num_seq',
  coalesce((select max(num) from public.roadmap_items), 0) + 1,
  false
);

alter table public.roadmap_items
  alter column num set default nextval('public.roadmap_items_num_seq');
alter table public.roadmap_items alter column num set not null;

create unique index if not exists roadmap_items_num_key
  on public.roadmap_items (num);

comment on column public.roadmap_items.num is
  'Card number shown as #N on the Roadmap. Assigned once, never reused.';
