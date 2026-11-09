-- April Plan > Todo: Dan's action items for the plan, ticked off by hand.
-- Three sections: today's five, this week's goals and this month's goals
-- (vault: wiki/subscription-growth-library.md "The five to start today" and
-- wiki/revenue-100k-question.md "Goals for the week of Nov 9 and the month to
-- mid-December", 2026-11-09). Stored here, not in the browser, so a tick on one
-- computer shows on the other. Service-role only: /api/plan/todos.

create table if not exists public.plan_todos (
  id uuid primary key default gen_random_uuid(),
  section text not null default 'today'
    check (section in ('today', 'week', 'month')),
  title text not null,
  note text not null default '',
  due_date date,
  position double precision not null default 0,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_todos_section_idx on public.plan_todos (section, position);

comment on table public.plan_todos is
  'DAD April Plan > Todo: Dan''s plan action items (today / this week / this month), checked off by hand. Service-role only.';

alter table public.plan_todos enable row level security;
revoke all on public.plan_todos from anon, authenticated;

-- Seed (fixed ids: re-running never duplicates or un-ticks anything).
insert into public.plan_todos (id, section, title, note, due_date, position) values
  ('5ddbc5e4-b3ea-5a53-a8bd-982d2fc3aadf'::uuid, 'today', $q$First price test: monthly $19.99 vs $14.99$q$, $q$Yearly unchanged. App Store product is waiting for Apple's review and RevenueCat experiment exp3c4c49c707 is a draft. Left: Apple approval, the Thu Nov 12 mentor calls, then press Start. Vault: wiki/pricing.md, First price test.$q$, '2026-11-09'::date, 1),
  ('dcefb226-c262-59c0-99c2-76d219e7f24e'::uuid, 'today', $q$Black Friday and January offer to the 54,000 non-payers$q$, $q$50% off the first year of the main Yearly product, then $69.99. Black Friday week goes to the 11,279 active in the last 30 days or who once trialed or paid; widen in January.$q$, '2026-11-09'::date, 2),
  ('ca34ce78-53c4-5ff7-b1c0-e3cd4af1ce76'::uuid, 'today', $q$Meta November reset$q$, $q$Attach the subscriber exclusion to the 7 active ad sets, move about $150 a day from Statics to Videos at the same total, approve the Nov 16 - Dec 13 switchback with Black Friday week as a low week.$q$, '2026-11-09'::date, 3),
  ('a67bcffc-7bd7-5381-ac18-78b2a3a44e43'::uuid, 'today', $q$First-shot static batch into the test lane$q$, $q$Four Facebook-group-style text posts, two Reddit-style screenshots, five Newspaper Review variants that change the visual hook.$q$, '2026-11-09'::date, 4),
  ('03660641-3b74-5b4b-8019-b090f4a72fa3'::uuid, 'today', $q$Day-0 and day-1 email to new trialists from Dan$q$, $q$Half held back as a control. Plus the Apple Retention Messaging follow-up.$q$, '2026-11-09'::date, 5),
  ('c9317596-3e3c-5ac6-90d2-b72fbf510c52'::uuid, 'week', $q$Press Start on the $19.99 monthly price test$q$, $q$Needs Apple's approval and Thursday's mentor calls first. RevenueCat experiment exp3c4c49c707.$q$, '2026-11-13'::date, 1),
  ('88b6358e-f549-5e1e-a90a-9221d17500f4'::uuid, 'week', $q$Meta: exclusion attached, $150/day to Videos$q$, $q$Subscriber exclusion on the 7 active ad sets; about $150 a day moved from Statics to Videos at the same total.$q$, '2026-11-13'::date, 2),
  ('6cb02924-621f-5780-bcbc-62b640d6ef43'::uuid, 'week', $q$Approve the Meta on/off switchback$q$, $q$So it starts Nov 16 and ends Dec 13.$q$, '2026-11-13'::date, 3),
  ('479a1113-8a00-5db0-b119-34a1d8e4eda1'::uuid, 'week', $q$Black Friday ready to send$q$, $q$Offer, list (11,279 people), copy and sending channel approved, for sends the week of Nov 23.$q$, '2026-11-13'::date, 4),
  ('646ba19b-e099-5733-a4bb-85dc8ad320fc'::uuid, 'week', $q$David's answer on the renewal offer sandbox check$q$, $q$Handoff sent Nov 9.$q$, '2026-11-13'::date, 5),
  ('e0395886-7674-5583-a8c2-be801a89ec48'::uuid, 'month', $q$Read the price test and ship the next paywall test$q$, $q$Read it at 4 to 6 weeks and get the next paywall test into David's next release. Target: iOS value per trial from about $15 back toward $17.58.$q$, '2026-12-13'::date, 1),
  ('351387e9-3b67-592b-8bcd-0c0d344d7e5c'::uuid, 'month', $q$One controlled cost per extra Meta trial$q$, $q$From the switchback. It sets January's budget.$q$, '2026-12-13'::date, 2),
  ('74aafa46-ecc9-5f3e-be50-0346a485a93b'::uuid, 'month', $q$January ad bench$q$, $q$About 30 new concepts aimed at first-shot women through the test lane, to find 2 or 3 that hold up.$q$, '2026-12-13'::date, 3),
  ('50f78aa7-2d80-5339-b8c6-2e43cac55213'::uuid, 'month', $q$Black Friday sent, January offer drafted$q$, $q$Black Friday sent to the 11,279, and the January offer drafted for all 54,197 non-payers.$q$, '2026-12-13'::date, 4),
  ('f2889e29-59b6-5d10-af03-3b723037d232'::uuid, 'month', $q$Renewals on schedule for Feb 1$q$, $q$Renewal status line in a release, and Dan's Apple offers created (upgrade_yearly_50, offer codes).$q$, '2026-12-13'::date, 5)
on conflict (id) do nothing;
