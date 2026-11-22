# Errors tab: our own error tracker (in place of sentry.io)

The app keeps the `@sentry/react-native` SDK. Only its DSN changes, so it
sends to the DAD instead of sentry.io. The DAD accepts Sentry's envelope
protocol, groups errors into issues, and shows them on the **Errors** tab
(`?tab=errors`, admin only). New, regressed and spiking issues, and a tracker
that has gone quiet, show up in the Overview's "Needs attention".

## Switching it on

1. Vercel env (Production):
   - `ERRORS_DSN_PUBLIC_KEY`: any random 32-character hex string. It is public (it ships in the app bundle), like a Sentry DSN key.
   - `ERRORS_PROJECT_ID`: optional, default `1`. `next.config.ts` reads it at build time for the rewrite, so changing it needs a redeploy.
   - `ERRORS_CAP_PER_MINUTE`: optional, default 300.
2. Migration `0123_error_tracker.sql` creates the tables, the `error-sourcemaps` bucket and the `err-prune` pg_cron job. It was applied to DreamMe Internal on 2026-11-22.
3. In the app (`app/_layout.tsx`), set the DSN to
   `https://<ERRORS_DSN_PUBLIC_KEY>@<dad host>/<ERRORS_PROJECT_ID>`.
   Also turn off what the DAD drops: `tracesSampleRate: 0`, `profilesSampleRate: 0`, no `mobileReplayIntegration`, replay rates 0.
   The DSN host can only change with an app release, so pick it once (a `dreamme.life` subdomain survives a move off Vercel).
4. Source maps (readable JavaScript stacks): after each `npx expo export` (EAS Update) and each native build, run
   `DAD_URL=… DAD_TOKEN=<x-dreamme-secret> node scripts/upload-error-sourcemaps.mjs <dir> [--release R --dist D]`.
   This repo is public, so keep the token out of the app repo; use an EAS secret.

## How it works

- **Ingest:** `POST /api/<project>/envelope/` is rewritten to `/api/errors/envelope` (`src/lib/errors/ingest.ts`).
  - It handles gzip/deflate/br bodies, `length`-prefixed and newline items (attachments included), and the key from the `sentry_key` query, the `X-Sentry-Auth` header or the envelope's `dsn`.
  - Only `event` items are stored. Everything else is acknowledged and dropped.
  - Every response carries `X-Sentry-Rate-Limits: 86400:transaction;span;profile;…;replay;session;attachment;…`, so the SDK stops sending those for a day. Checked with the real `@sentry/core` 10.30 client: after one response it dropped the next transaction itself.
  - It never answers 5xx, because SDKs resend cached envelopes after server errors. A database failure answers 429 with `Retry-After: 300`. Over `ERRORS_CAP_PER_MINUTE` it answers 429 with `Retry-After: 60`, and that event is accepted when retried.
- **Grouping** (`src/lib/errors/event.ts`, `GROUPING_VERSION` 1, stored on each issue):
  - An SDK `fingerprint` wins.
  - Otherwise: exception type + message with digits, hex, UUIDs, paths, emails and URL query strings normalized.
  - Native events (`cocoa`, `java`, `native`) add the crash-site frame. Messages like "App hanging for at least 2000 ms" would otherwise merge every hang.
  - JS frames are left out on purpose: Hermes production frames are minified.
- **Scrubbing** is an allowlist. Dropped: emails, IPs, cookies, request bodies, `extra`, local variables, breadcrumb URL query strings. Kept: the app user id (a UUID), so an issue can be tied to a support thread. Users are counted by a hash of the user id, or of the device hash for signed-out users.
- **Storage** (all service-role only, RLS on; `err_ingest()` is not executable by `anon`):
  - `err_issues`
  - `err_events`: up to 15 samples per issue, plus the first from each release, kept 60 days.
  - `err_issue_daily`
  - `err_issue_users`
  - `err_seen`: dedupe by event id, 3 days.
  - `err_ingest_minute`
  - `err_sourcemaps`
  - A resolved issue that gets a new event goes back to unresolved with `regressed_at` set.
- **Symbolication** (`src/lib/errors/symbolicate.ts`):
  - It runs when someone opens an event, not at ingest. The result is saved on `err_events.symbolicated`, and the issue's minified culprit is replaced with the resolved function.
  - The map is found by the event's `debug_meta` sourcemap debug id. Sentry's Metro plugin writes `debugId` into the map, and `copy-debugid.js` copies it into the Hermes map on native builds. Without one, release + dist + bundle name is used.
  - Maps are uploaded gzipped through a signed storage URL, because Vercel caps request bodies at 4.5 MB.

## Not proven yet

- **No device has sent to it.** Tested with the real `@sentry/core` 10.30 client, `sentry-cli send-event`, and hand-built envelopes shaped like sentry-cocoa's (gzip, `X-Sentry-Auth`, length-prefixed items, an attachment, a session item). A real iOS and Android build should be pointed at a preview deployment before the DSN ships.
- **Hermes column semantics:** frames are resolved as line, column-1 into the uploaded map, the same as Sentry's generic JS path. Checked against a synthetic map only. Confirm on the first real event with an uploaded map.
- **Native iOS crashes are not symbolicated** (no dSYM handling). They are grouped by type, message and crash-site function. Use Xcode Organizer for the readable native stack.
- **Old app versions keep reporting to sentry.io.** Only versions with the new DSN appear here.
