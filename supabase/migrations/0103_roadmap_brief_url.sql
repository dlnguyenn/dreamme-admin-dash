-- Roadmap cards can link to a brief: a DAD brief (src/lib/briefs/<slug>.md,
-- opened at /?tab=roadmap&brief=<slug>) or any http(s) page.
alter table public.roadmap_items add column if not exists brief_url text;

comment on column public.roadmap_items.brief_url is
  'Link to the item''s brief. A DAD brief link (?tab=roadmap&brief=<slug>) opens in the Roadmap''s reader; anything else opens in a new tab.';
