-- Add 9 casting-test personas to the deliveries persona check constraint so
-- their casting-test selfies can be posted to the content pipeline for review.
-- These are casting/review candidates, dashboard-side only -- NOT enrolled in
-- n8n daily generation. Mirrors the pattern in 0013_add_hannah.sql.
--
-- Scope is intentionally limited to `deliveries`: casting personas only receive
-- their selfies, not generated captions/hooks. The other persona-constrained
-- tables (saved_captions, generated_captions, generated_hooks, tiktok_posts,
-- pipeline_hooks) are deliberately left unchanged so these candidates stay out
-- of the caption/hook generation flows.
--
-- 'jess' is already present in every persona constraint (added out-of-band) and
-- is kept here so the rebuilt constraint stays authoritative.

alter table public.deliveries drop constraint if exists deliveries_persona_check;
alter table public.deliveries add constraint deliveries_persona_check
  check (persona in (
    'andrea','emma','olivia','mia','abby','diane','sydney','maddy','hannah','jess',
    'hailey','taylor','max','ava','rachel','sarah','jessica','alex','maya'
  ));
