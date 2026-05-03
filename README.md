# DreamMe — Internal Dashboard

A private "dashboard of dashboards" for the DreamMe team. Ports the design
bundle in `design_handoff_dreamme_dashboard/` to a production Next.js +
Supabase app, pixel-faithfully.

## Screens

- **Content Pipeline** (live) — three-persona daily output from the
  *DreamMe Daily Content Pipeline (3 Personas)* n8n workflow, grouped by date,
  with a detail drawer + caption editor.
- **Caption Library** (live) — saved captions, searchable and filterable.
- **Hook Analytics** (live) — scrapes the three TikTok accounts via Apify,
  OCRs the first-slide hook with Claude vision, auto-categorizes, and
  generates 2 new hooks per persona per day from top performers.
- **Posting Analytics / Comment Monitoring / Content Poster** — scaffolded
  "coming soon" screens with planned-feature bullets.

## Stack

- Next.js 15 (App Router) + TypeScript
- React 19
- Supabase — Postgres + Storage (anon-key + service-role)
- Zod for ingest payload validation
- Fonts: Newsreader + Geist + Geist Mono via `next/font`

## Data model

Matches the design handoff exactly:

```
deliveries          id · persona · image_url · caption · posted · starred · in_library · created_at
saved_captions      id · source_delivery_id · persona · caption · posted · starred · created_at
```

Storage bucket: `dreamme-admin-internal-images` (public read). Apply
`supabase/migrations/0001_init.sql` via the Supabase SQL editor or
`npx supabase db push`.

## Auth

A shared team-password gate (`dreamme`) on the client, sessionStorage-backed —
matches the design. Swap for Supabase Auth when you're ready; the gate is
isolated in `src/components/Gate.tsx`.

## Local setup

```bash
cp .env.local.example .env.local   # fill in Supabase URL + keys + INGEST_TOKEN
npm install
npm run dev
```

Visit http://localhost:3000 and enter `dreamme`.

## n8n ingest

Two options, both documented in the in-app **n8n setup** modal (Content
Pipeline → top-right):

**Option A — direct to Supabase PostgREST** (recommended; the design's default):

```
POST  {SUPABASE_URL}/rest/v1/deliveries
HEADERS: apikey, Authorization: Bearer <ANON>, Content-Type: application/json
BODY:    { "persona": "andrea|emma|olivia", "image_url": "…", "caption": "…" }
```

**Option B — this app's server endpoint** (handles base64 uploads or refetches
`image_url` into Supabase Storage):

```
POST  /api/ingest/content-pipeline
HEADERS: X-DreamMe-Secret: <INGEST_TOKEN>
BODY:
  { "persona": "andrea", "caption": "…", "image_base64": "…" }
  — or —
  { "items": [{"persona":"andrea","image_url":"…","caption":"…"}, …] }
```

### Smoke test

```bash
curl -X POST http://localhost:3000/api/ingest/content-pipeline \
  -H "X-DreamMe-Secret: $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"persona":"andrea","image_url":"https://picsum.photos/400/500","caption":"test andrea"},
      {"persona":"emma",  "image_url":"https://picsum.photos/400/500","caption":"test emma"},
      {"persona":"olivia","image_url":"https://picsum.photos/400/500","caption":"test olivia"}
    ]
  }'
```

A new row should appear in the dashboard within 30 seconds (or hit **Refresh**).

## Hook Analytics

The **Hook Analytics** screen scrapes three fixed TikTok profiles
(`@andreaglp1`, `@glp1withemma`, `@glpolivia`), OCRs the first-slide text
overlay, categorizes it, and generates 2 new hooks per persona per day.

**Flow:**

1. `POST /api/scrape/tiktok` — runs the Apify actor, OCRs new first slides
   via Claude vision, categorizes, upserts into `tiktok_posts`.
2. `POST /api/generate/hooks` — for each persona, takes their top hooks +
   top cross-pollinated hooks from other personas and asks Claude to
   generate `perPersona` new ones. Writes to `generated_hooks`.

Both endpoints accept `X-DreamMe-Secret: <INGEST_TOKEN or CRON_SECRET>`, or
are callable from the dashboard UI (same-origin is allowed).

**Cron:** `vercel.json` schedules `/api/cron/scrape` at 06:00 UTC and
`/api/cron/generate` at 07:00 UTC daily. Vercel auto-adds
`Authorization: Bearer $CRON_SECRET` if `CRON_SECRET` is in the env.

**Apply the migration** (`supabase/migrations/0002_hooks.sql`) to get the
`tiktok_posts` and `generated_hooks` tables.

## SynthID Research (internal only)

Admin-only screen for studying Google's SynthID watermark on Gemini-generated
images. Calls a separate Python FastAPI service that wraps
[aloshdenny/reverse-SynthID](https://github.com/aloshdenny/reverse-SynthID).

**This is research-only.** The upstream tool's license restricts use to
academic research / security analysis, and removing SynthID likely violates
the Gemini API ToS. Do not pipe output into the customer-facing pipeline.

**Setup:**

1. In the analytics repo, run the service: see `services/synthid/README.md`.
2. Set `SYNTHID_SERVICE_URL` and `SYNTHID_SERVICE_TOKEN` in `.env.local`.
3. Apply `supabase/migrations/0010_synthid_research.sql` (run-log table only).

The screen lives at the **SynthID Research** nav entry (admin view only).

## Deploy

1. Push to GitHub, import in Vercel.
2. Set these env vars in Vercel:
   - Core: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `NEXT_PUBLIC_SUPABASE_BUCKET`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_TOKEN`.
   - Hook Analytics: `APIFY_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`.
3. Apply `supabase/migrations/0001_init.sql` and `0002_hooks.sql` on the
   Supabase project.
