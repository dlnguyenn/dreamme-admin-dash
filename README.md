# DreamMe — Internal Dashboard

A private "dashboard of dashboards" for the DreamMe team. Ports the design
bundle in `design_handoff_dreamme_dashboard/` to a production Next.js +
Supabase app, pixel-faithfully.

## Screens

- **Content Pipeline** (live) — three-persona daily output from the
  *DreamMe Daily Content Pipeline (3 Personas)* n8n workflow, grouped by date,
  with a detail drawer + caption editor.
- **Caption Library** (live) — saved captions, searchable and filterable.
- **Posting Analytics / Comment Monitoring / Hook Analytics / Content Poster**
  — scaffolded "coming soon" screens with planned-feature bullets.

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

## Deploy

1. Push to GitHub, import in Vercel.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_TOKEN` in Vercel env.
3. Apply `supabase/migrations/0001_init.sql` on the Supabase project.
