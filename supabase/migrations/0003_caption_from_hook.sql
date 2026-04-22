-- Caption-from-hook: link saved_captions to a source hook and persist generation metadata.

alter table public.saved_captions
  add column if not exists source_hook_id uuid references public.generated_hooks(id) on delete set null;

create index if not exists saved_captions_source_hook_id_idx
  on public.saved_captions (source_hook_id);

create table if not exists public.generated_captions (
  id uuid primary key default gen_random_uuid(),
  hook_id uuid references public.generated_hooks(id) on delete set null,
  persona text not null check (persona in ('andrea','emma','olivia')),
  caption text not null,
  model text not null,
  notes text,
  tip_pool_aware boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists generated_captions_hook_id_idx
  on public.generated_captions (hook_id);
create index if not exists generated_captions_created_at_idx
  on public.generated_captions (created_at desc);

alter table public.generated_captions enable row level security;

drop policy if exists "generated_captions_anon_read" on public.generated_captions;
drop policy if exists "generated_captions_anon_write" on public.generated_captions;

create policy "generated_captions_anon_read" on public.generated_captions
  for select using (true);
create policy "generated_captions_anon_write" on public.generated_captions
  for all using (true) with check (true);
