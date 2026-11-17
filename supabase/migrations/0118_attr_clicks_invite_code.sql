-- WHY (2026-11-16): personal invite links, https://go.dreamme.life/i/<code>
-- (vault wiki/share-app-card-design.md). Each tap is an attr_clicks row with
-- media_source 'invite'; this column holds the inviter's code so installs,
-- trials and paid can be counted per inviter. Nullable and additive: every
-- existing row and the ad link (/l) are untouched. insertClick drops the
-- column on retry if this migration has not been applied yet.
alter table public.attr_clicks add column if not exists invite_code text;

create index if not exists attr_clicks_invite_code_idx
  on public.attr_clicks (invite_code, clicked_at desc)
  where invite_code is not null;
