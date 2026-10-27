-- Product Roadmap tab: what needs to be done, in Now / Next / Later / Done.
-- Replaces keeping the list in Discord. Items are added by hand in the tab
-- or promoted from a Feature Requests ticket (feature_request_id); a linked
-- ticket's status follows its item's stage (see src/lib/roadmap.ts).
create table if not exists public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text not null default '',
  stage text not null default 'next'
    check (stage in ('now','next','later','done')),
  priority text not null default 'normal'
    check (priority in ('high','normal','low')),
  area text,                            -- app area, same list as ticket briefs
  owner text,                           -- free text: "Dan", "David", ...
  target_date date,
  position double precision not null default 0,  -- order within a stage, low first
  feature_request_id uuid references public.feature_requests(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_items_stage_idx
  on public.roadmap_items (stage, position);
create index if not exists roadmap_items_feature_request_idx
  on public.roadmap_items (feature_request_id);

comment on table public.roadmap_items is
  'DAD Product Roadmap tab items (Now/Next/Later/Done); service-role only.';

alter table public.roadmap_items enable row level security;
-- service-role only.
