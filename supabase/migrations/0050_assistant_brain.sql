-- Assistant brain — the Runneth-style shared marketing brain that fronts
-- Outlier's Assistant tab. Four stores:
--   assistant_docs           the trainable knowledge base ("the brain"):
--                            brand context, SOPs, insights, meeting
--                            transcripts, templates. The agent reads it
--                            (search/read tools) AND writes it
--                            (save_brain_doc, source='assistant').
--                            Pinned docs ride along in the system prompt.
--   assistant_conversations  durable chat threads (team-shared, unlike the
--                            Analyst's localStorage transcript)
--   assistant_messages       the turns of each thread (+ tool-step trace)
--   assistant_briefs         saved creative briefs (the signal→brief pipeline)
-- Reads: anon (Outlier UI + tools). Writes: service-role only (0039 pattern).

create table if not exists public.assistant_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  doc_type text not null default 'note'
    check (doc_type in ('brand','sop','insight','transcript','template','note')),
  tags text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual','assistant')),
  pinned boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as
    (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored
);

create index if not exists assistant_docs_fts_idx
  on public.assistant_docs using gin (fts);
create index if not exists assistant_docs_updated_idx
  on public.assistant_docs (updated_at desc);

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_updated_idx
  on public.assistant_conversations (updated_at desc);

create table if not exists public.assistant_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null
    references public.assistant_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  steps jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_conv_idx
  on public.assistant_messages (conversation_id, id);

create table if not exists public.assistant_briefs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brief_md text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','archived')),
  conversation_id uuid
    references public.assistant_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_briefs_created_idx
  on public.assistant_briefs (created_at desc);

alter table public.assistant_docs enable row level security;
drop policy if exists "assistant_docs_anon_read" on public.assistant_docs;
create policy "assistant_docs_anon_read" on public.assistant_docs
  for select using (true);

alter table public.assistant_conversations enable row level security;
drop policy if exists "assistant_conversations_anon_read" on public.assistant_conversations;
create policy "assistant_conversations_anon_read" on public.assistant_conversations
  for select using (true);

alter table public.assistant_messages enable row level security;
drop policy if exists "assistant_messages_anon_read" on public.assistant_messages;
create policy "assistant_messages_anon_read" on public.assistant_messages
  for select using (true);

alter table public.assistant_briefs enable row level security;
drop policy if exists "assistant_briefs_anon_read" on public.assistant_briefs;
create policy "assistant_briefs_anon_read" on public.assistant_briefs
  for select using (true);
