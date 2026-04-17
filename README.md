# DreamMe Admin Dash

A private "dashboard of dashboards" for tools that help DreamMe grow.

**First dashboard:** results from the **DreamMe Daily Content Pipeline (3 Personas)**
N8N workflow — three persona buckets (Andrea / Emma / Olivia) with all generated
images, plus a searchable "All captions" bucket, plus a **Run Now** button that
triggers the workflow on demand.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind + lucide-react
- **Supabase** — Postgres + Auth (magic link) + Storage
- **Vercel** (free hobby) for hosting
- Zod for payload validation

## Project layout

```
src/
  app/
    layout.tsx, page.tsx                    # app shell + dashboard grid
    login/                                  # magic-link auth
    auth/callback/                          # OAuth/OTP code exchange
    dashboards/daily-content/
      page.tsx                              # 3 persona columns + Run Now
      item/[id]/                            # image + caption detail
      captions/                             # all-captions bucket
    api/
      ingest/                               # N8N → dashboard webhook
      run/                                  # dashboard → N8N trigger
  components/                               # Sidebar, PersonaColumn, CopyButton, …
  lib/                                      # supabase clients, queries, env, storage
supabase/migrations/0001_init.sql           # schema + RLS + persona seed
```

## Local setup

1. **Create a Supabase project** (free tier is fine).
2. Copy the env template and fill it in:
   ```bash
   cp .env.local.example .env.local
   ```
   You'll need:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase → Project Settings → API
   - `SUPABASE_SERVICE_ROLE_KEY` — same page (keep it secret; server-only)
   - `ALLOWED_EMAILS` — comma-separated allow list for sign-in
   - `INGEST_TOKEN` — generate a long random string; shared with N8N
   - `N8N_TRIGGER_WEBHOOK_URL` — production URL of the Webhook trigger node in N8N
3. **Apply the schema.** Easiest path: open `supabase/migrations/0001_init.sql` in the Supabase SQL editor and run it. Or with the CLI:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
4. Install + run:
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000, sign in with an allow-listed email.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. Set the same env vars in Vercel → Project → Settings → Environment Variables.
4. After deploy, set `NEXT_PUBLIC_APP_URL` to the Vercel domain and redeploy. Update the Supabase **Auth → URL Configuration → Site URL** to match, and add the Vercel domain to **Redirect URLs**.

## N8N wiring

### 1. Push each run to the dashboard (`/api/ingest`)

Add an **HTTP Request** node at the end of `DreamMe Daily Content Pipeline (3 Personas)`.

- Method: `POST`
- URL: `https://<your-vercel-domain>/api/ingest`
- Headers:
  - `Authorization: Bearer <INGEST_TOKEN>`
  - `Content-Type: application/json`
- Body (JSON): one of the two shapes below.

**With base64 images** (simplest; N8N's `Move Binary Data` → "Binary to Base64"):

```json
{
  "run_id": "{{$execution.id}}",
  "triggered_by": "schedule",
  "caption": "{{$json.caption}}",
  "items": [
    { "persona": "andrea", "image_base64": "{{$json.andrea_b64}}", "image_mime": "image/png" },
    { "persona": "emma",   "image_base64": "{{$json.emma_b64}}",   "image_mime": "image/png" },
    { "persona": "olivia", "image_base64": "{{$json.olivia_b64}}", "image_mime": "image/png" }
  ]
}
```

**With image URLs** (the server will fetch + re-upload to Storage):

```json
{
  "run_id": "{{$execution.id}}",
  "caption": "{{$json.caption}}",
  "items": [
    { "persona": "andrea", "image_url": "{{$json.andrea_url}}" },
    { "persona": "emma",   "image_url": "{{$json.emma_url}}" },
    { "persona": "olivia", "image_url": "{{$json.olivia_url}}" }
  ]
}
```

Valid `persona` values: `andrea`, `emma`, `olivia`.

### 2. Let the dashboard trigger the workflow (`/api/run`)

Add a **Webhook** trigger node to the workflow (method POST, "Production URL"),
and set `N8N_TRIGGER_WEBHOOK_URL` in the dashboard's env to that URL. The **Run
Now** button POSTs to it.

## Data model quick-reference

- `personas` — Andrea, Emma, Olivia (seeded).
- `workflow_runs` — one row per N8N execution (ingest) or manual trigger.
- `captions` — every long-form caption, with `char_count` + optional `tags`. This is what powers the "All captions" bucket.
- `content_items` — one per persona image per run; references the shared `caption_id` so each caption appears both under its image **and** in the captions bucket without duplication.

Images are stored in a private `persona-images` bucket (`<persona>/<run>-<uuid>.<ext>`) and served as signed URLs.

## Smoke test

```bash
# With the dev server running and INGEST_TOKEN set:
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "caption": "test caption",
    "items": [
      {"persona":"andrea","image_url":"https://placehold.co/900x1200.png"},
      {"persona":"emma","image_url":"https://placehold.co/900x1200.png"},
      {"persona":"olivia","image_url":"https://placehold.co/900x1200.png"}
    ]
  }'
```

Then visit `/dashboards/daily-content` and `/dashboards/daily-content/captions`.
