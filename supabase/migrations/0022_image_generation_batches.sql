-- Async Gemini Batch image-gen jobs. Each row tracks one
-- :batchGenerateContent submission. Polling is lazy-on-read in
-- src/lib/image-generation-batch.ts:getImageBatch().

create table if not exists public.image_generation_batches (
  id uuid primary key default gen_random_uuid(),
  -- Gemini's resource name: "batches/abc123…". Stored once, never edited.
  gemini_batch_name text not null unique,
  -- Mirror of Gemini's BatchState enum: PENDING | RUNNING | SUCCEEDED |
  -- FAILED | CANCELLED. We update on each poll.
  status text not null,
  item_count int not null,
  -- The full input items the caller submitted (prompts + reference URLs).
  items jsonb not null,
  -- Once SUCCEEDED, populated with one entry per item:
  --   { image_generation_id?, image_url?, error? }
  results jsonb,
  gemini_model text not null,
  source text not null,                 -- 'mcp' | 'dashboard'
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create index if not exists image_generation_batches_status_idx
  on public.image_generation_batches (status, submitted_at desc);

alter table public.image_generation_batches enable row level security;
drop policy if exists "image_generation_batches_anon_all"
  on public.image_generation_batches;
create policy "image_generation_batches_anon_all"
  on public.image_generation_batches for all using (true) with check (true);
