# Trial-quality silent pushes (`/api/cron/trial-pings`)

Wakes each trial user's device at **+2h** (`trial_qualified`) and **+24h**
(`trial_engaged`) after trial start with a silent Expo push. The app then
re-checks `willRenew` on-device and fires the event to the **Meta SDK** and
**Singular** — the trial-*quality* signals that separate "campaign X drove 40
trials" from "…of which 9 survived."

## History: why this exists

Until July 2026 this was an n8n workflow (`wEZAcV8qNd0OTUBQ` on
`n8n.dreammeops.us`). The n8n instance went offline **~2026-07-06** (Cloudflare
tunnel origin unreachable) and nothing noticed for five weeks: the only watcher
was this repo's `sync-qualified-trials` cron, which itself started failing
silently the same day (`qualified_trials_daily` flatlined — that table is the
forensic record). All device pings AND the workflow's server-side Meta CAPI
copies stopped together. Discovered 2026-08-15 when v1.5.0 shipped Singular
mirrors for these events and zero arrived.

Replacement design goals, in order: **can't die silently**, can't double-ping,
zero app-side changes.

## Architecture

```
rc_events (internal DB, RC webhook feed — near-real-time trials)
   │  every 15 min: GitHub Actions .github/workflows/trial-pings.yml
   ▼  curl → /api/cron/trial-pings (CRON_SECRET auth)
window scan  ── qualified: event_at in [now-6h, now-2h]
             ── engaged:   event_at in [now-28h, now-24h]
   ▼
CLAIM in trial_ping_log  (PK insert, ignore-duplicates — only claimed rows send)
   ▼
push_tokens (CONSUMER DB, read-only) — newest token per user
   ▼
Expo push API (silent: _contentAvailable, no title/body)
   ▼
device wakes → utils/notificationHandler.ts (DreamMe app, unchanged)
   → willRenew re-check → Meta SDK + Singular events → AsyncStorage ledger
```

## Correctness properties

- **At-most-once per (trial, ping type)** — the `trial_ping_log` PRIMARY KEY
  claim happens BEFORE any send; crashed or overlapping runs cannot
  double-ping. The app's own ledger is a second, independent layer.
- **Scheduler-lag tolerant** — 4h catch-up windows vs 15-min cadence means a
  trial is visible to ~16 consecutive runs; GitHub cron jitter is harmless.
- **Outages > 4h drop pings permanently, by design** — a "+2h qualified" check
  delivered at +9h measures a different thing. No backfill.
- **Visible failure** — a non-200 route response fails the Actions run (red in
  the Actions tab + GitHub's scheduled-workflow failure emails). Ledger rows
  claimed but not delivered keep `expo_status = null` — queryable, not lost.
  `expo_status` values: `ok`, `no_token`, `error:<ExpoErrorCode>`.

## Configuration

| Where | What |
| --- | --- |
| Vercel env | `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, internal service role, `CONSUMER_SUPABASE_URL`, `CONSUMER_SERVICE_ROLE_KEY` (all pre-existing) |
| GitHub repo secret | `CRON_SECRET` (same value as Vercel) — **required**, Actions fails with a clear error without it |

## Deliberate non-goals

- **No Meta CAPI server-copies** (v1). n8n also mirrored these events
  server-side to the *web* dataset (`docs/attribution-handoff.md`). On-device
  firing is the primary signal; add CAPI redundancy only if Meta optimization
  proves to need it.
- **No push-token hygiene.** `DeviceNotRegistered` outcomes are recorded in
  `expo_detail` but tokens are never deactivated from here — the consumer DB
  is the app team's domain.
- **One device per user** — newest token only. Every device runs its own
  client ledger, so pushing to all devices would double-fire events.
- **RC anonymous ids** (`$RCAnonymousID:…`) can't match a `push_tokens` row →
  recorded as `no_token`.

## Smoke test

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://dreamme-admin-dash.vercel.app/api/cron/trial-pings" | jq
# → { ok: true, candidates: N, claimed: n, sent_ok: n, expo_errors: 0, no_token: m }
```

Or Actions → trial-pings → Run workflow. End-to-end proof: a `trial_ping_log`
row with `expo_status='ok'`, then the event appearing in Singular's raw event
stream and Meta Events Manager (App connection method) minutes later.

## Downstream

Once real `trial_qualified` / `trial_engaged` events reach Singular, register
both in **Settings → Events** (custom events appear in the dropdown only after
first receipt) — that unblocks per-campaign trial-quality via cohort metrics
(see `docs/singular-mmp-setup.md`).

Still on n8n and still dead as of 2026-08-15: the Monday growth-recap email
webhook and anything else on that instance. Reviving or migrating those is a
separate decision.
