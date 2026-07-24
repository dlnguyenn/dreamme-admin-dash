-- Support Inbox: help@ email + in-app feedback triage.
--
-- One thread = one conversation with one counterpart. Email threads chain by
-- RFC Message-ID / References; in-app feedback rows map 1:1 to threads via
-- feedback_id. All ingestion is idempotent: support_messages.message_id and
-- support_threads.feedback_id are unique, so re-polling can never duplicate.

create table if not exists support_threads (
  id                   uuid primary key default gen_random_uuid(),
  source               text not null check (source in ('email','feedback')),
  channel              text,                -- 'help' | 'feedback' (from To: header) | 'in_app'
  status               text not null default 'new'
                       check (status in ('new','drafts_ready','waiting_user','closed','ignored')),
  snoozed_until        timestamptz,
  unread               boolean not null default true,
  subject              text,
  counterpart_email    text,
  counterpart_name     text,
  category             text,                -- refund_request|cancel_trial|question|feedback|other
  urgency              text,                -- low|normal|high
  resolved_app_user_id text,
  resolved_store       text,                -- STRIPE|PLAY_STORE|APP_STORE
  user_context         jsonb,
  triage               jsonb,
  feedback_id          uuid unique,         -- consumer public.feedback.id
  last_message_at      timestamptz not null default now(),
  last_inbound_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists support_threads_status_idx
  on support_threads (status, last_message_at desc);
create index if not exists support_threads_email_idx
  on support_threads (counterpart_email);

create table if not exists support_messages (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references support_threads(id) on delete cascade,
  direction      text not null check (direction in ('inbound','outbound')),
  via            text not null check (via in ('email','feedback')),
  message_id     text,                      -- RFC 5322 Message-ID incl. <>
  in_reply_to    text,
  references_ids text[] not null default '{}',
  from_email     text,
  to_email       text,
  subject        text,
  body_text      text,
  body_html      text,
  attachments    jsonb,
  imap_uid       bigint,
  sent_at        timestamptz not null,
  created_at     timestamptz not null default now()
);

create unique index if not exists support_messages_message_id_key
  on support_messages (message_id) where message_id is not null;
create index if not exists support_messages_thread_idx
  on support_messages (thread_id, sent_at);
create index if not exists support_messages_refs_idx
  on support_messages using gin (references_ids);

create table if not exists support_drafts (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references support_threads(id) on delete cascade,
  generation int not null default 1,
  variant    smallint not null,
  body       text not null,
  model      text,
  status     text not null default 'proposed'
             check (status in ('proposed','edited','sent','discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_drafts_thread_idx
  on support_drafts (thread_id, generation desc, variant);

create table if not exists support_actions (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid references support_threads(id) on delete set null,
  app_user_id text,
  store       text,
  action_type text not null,
  request     jsonb,
  response    jsonb,
  status      text not null check (status in ('success','error')),
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists support_actions_thread_idx on support_actions (thread_id);
create index if not exists support_actions_user_idx on support_actions (app_user_id);

create table if not exists support_cursors (
  id           text primary key,            -- 'gmail-inbox' | 'consumer-feedback'
  uidvalidity  bigint,
  last_uid     bigint,
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now()
);
