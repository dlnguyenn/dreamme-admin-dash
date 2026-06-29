# First-party SKAdNetwork / AdAttributionKit attribution ("DIY MMP")

We receive our **own copy** of Apple's winning install-validation postbacks,
decode them into trial / subscribe events per Meta campaign, and surface
cost-per-trial / cost-per-subscribe in the dashboard's **Marketing Efficiency**
tab — without paying for Singular/AppsFlyer and without depending on Meta Ads
Manager (which buries per-campaign iOS trial data).

RevenueCat stays the **source of truth for absolute counts**. SKAN is only good
enough to *rank* the campaigns it can resolve; Apple's privacy thresholds null
out low-volume campaigns (a paid MMP gets the exact same nulling).

---

## Architecture

```
iOS app (davngu28/DreamMe)
  Info.plist:
    NSAdvertisingAttributionReportEndpoint = https://dreamme-admin-dash.vercel.app/skan   (SKAN)
    AttributionCopyEndpoint                = https://dreamme-admin-dash.vercel.app/skan   (AdAttributionKit)
        │
        │  Apple appends its fixed well-known path and POSTs the signed postback:
        │    /skan/.well-known/skadnetwork/report-attribution/
        │    /skan/.well-known/adattributionkit/report-attribution/
        ▼
Next.js rewrite (next.config.ts) ──► /api/skan/collect?network=…
        │
        ├─ verify Apple's ECDSA P-256 signature           (src/lib/skan/verify.ts)
        ├─ decode conversion-value → event                (src/lib/skan/decode.ts + skan_cv_schema)
        ├─ map source-identifier → Meta campaign          (src/lib/skan/decode.ts + skan_campaign_mapping)
        └─ store append-only + de-dupe                    (src/lib/skan/server.ts → skan_postbacks)
        ▼
Postgres views (migration 0031)
    skan_campaign_efficiency   – per-campaign trials/subs + spend join + cost-per
    skan_reconciliation        – SKAN totals vs RevenueCat + blended CAC
        ▼
Dashboard → Marketing Efficiency → "First-party SKAN" section
    (src/components/MarketingEfficiency.tsx)
```

The collector lives **in this app** (not a Supabase Edge Function) so it reuses
the service-role key and Meta OAuth token already here.

---

## The endpoint

Apple composes the postback URL as **`<endpoint base>` + `<fixed well-known
path>`**. Our chosen base is `https://dreamme-admin-dash.vercel.app/skan`, so
Apple POSTs to:

| Network          | Full URL Apple POSTs to |
| ---------------- | ----------------------- |
| SKAdNetwork      | `https://dreamme-admin-dash.vercel.app/skan/.well-known/skadnetwork/report-attribution/` |
| AdAttributionKit | `https://dreamme-admin-dash.vercel.app/skan/.well-known/adattributionkit/report-attribution/` |

`next.config.ts` rewrites **both** the `/skan`-prefixed paths **and** the
bare-origin paths (`/.well-known/skadnetwork/report-attribution/`) to the
collector. So if Apple turns out to reject a path in the base URL on some iOS
version, changing the plist to the bare origin
`https://dreamme-admin-dash.vercel.app` works with **no code change**.

`GET /skan` returns a health/status JSON (config + total postbacks stored).

---

## iOS change (separate repo: davngu28/DreamMe) — copy-paste ready

This is an **Expo** app, so the Info.plist keys go through `ios.infoPlist` in
the Expo config (`app.json` / `app.config.*`), **not** a raw Info.plist edit.
Add both keys under `expo.ios.infoPlist` (keep any existing keys like
`SKAdNetworkItems`):

```jsonc
{
  "expo": {
    "ios": {
      "infoPlist": {
        // SKAdNetwork: receive our own copy of the winning postback (iOS 15+)
        "NSAdvertisingAttributionReportEndpoint": "https://dreamme-admin-dash.vercel.app/skan",

        // AdAttributionKit: receive our own copy of the AAK postback (iOS 17.4+)
        "AttributionCopyEndpoint": "https://dreamme-admin-dash.vercel.app/skan"

        // ...keep existing infoPlist keys (SKAdNetworkItems, etc.)
      }
    }
  }
}
```

Then ship it in the next **EAS build** — there's no runtime code to add; these
are static plist declarations Apple reads on install.

### Testing before a full store release (AdAttributionKit developer mode)

AAK has a **developer mode** that sends test postbacks in minutes instead of
days. On a development build / simulator:

1. Settings → Developer → **AdAttributionKit** → enable **Developer Mode**.
2. Trigger an impression+install from a test creative.
3. Developer-mode postbacks arrive at our endpoint within ~a minute. Confirm
   one landed: `GET https://dreamme-admin-dash.vercel.app/skan` → `total_postbacks` increments,
   or query `skan_postbacks` (service role) for the row.

Developer-mode postbacks are flagged by Apple and won't pollute production
counts the way you'd worry — but they DO get stored, so clear test rows before
reading real numbers if needed.

---

## Conversion-value → event schema (`skan_cv_schema`)

This is **our** SKAN 4.0 ladder, configured in Meta Events Manager on
2026-06-23 and seeded by migration `0031`. The collector reads this table at
decode time, so you can change the mapping **without a deploy** — just update
rows.

| Window         | Value kind | Value     | Event                   |
| -------------- | ---------- | --------- | ----------------------- |
| P1 (0–2d)      | fine       | 63        | purchase                |
| P1 (0–2d)      | fine       | 62        | subscribed              |
| P1 (0–2d)      | fine       | 61        | **trial_started**       |
| P1 (0–2d)      | fine       | 60        | complete_registration   |
| P2 (3–7d)      | coarse     | high      | **subscribed** (day-7 trial→paid) |
| P2 (3–7d)      | coarse     | medium    | trial_started           |
| P2 (3–7d)      | coarse     | low       | complete_registration   |

Fine values **0–59 are intentionally unmapped** → `decoded_event = null` (not
counted). P3 (8–35d) is unmapped for now (reserved for renewal/retention).

**To change the ladder** (must match what's configured in Meta Events Manager):

```sql
-- e.g. start mapping P3 high to a renewal event
insert into public.skan_cv_schema (postback_sequence_index, value_kind, coarse_value, event, note)
values (2, 'coarse', 'high', 'renewed', 'P3 coarse High = renewal');
```

Existing `skan_postbacks` rows keep their original `decoded_event`; re-decoding
historical rows would be a one-off backfill (the raw JSON is retained for
exactly this).

---

## source-identifier → Meta campaign mapping (`skan_campaign_mapping`) — THE hard part

The postback's `source-identifier` (SKAN 4: a 2–4 digit value; SKAN 3:
`campaign-id`) is assigned by **Meta**, and Meta does **not** publish a clean
source-id → named-campaign map. So this table is **best-effort and
hand-maintained**. Until a source-identifier is mapped, its events still count
but appear grouped under **"Unattributed · src NNNN"** in the UI.

### How to populate it

1. **Watch what arrives.** After postbacks start flowing, list the distinct
   source-identifiers we're actually receiving:
   ```sql
   select source_identifier, count(*), min(received_at), max(received_at)
   from public.skan_postbacks
   where signature_status = 'valid'
   group by 1 order by 2 desc;
   ```
2. **Correlate with Meta.** In Meta Ads Manager → the SKAN / app-attribution
   reporting view, the per-campaign **SKAdNetwork campaign ID / source ID**
   column (when above threshold) is the same value. Match it to the campaign
   name. Cross-check timing/volume against the campaign's installs.
3. **Insert the mapping:**
   ```sql
   insert into public.skan_campaign_mapping (network, source_identifier, meta_campaign_id, meta_campaign_name)
   values ('skadnetwork', '5239', '120246868370250622', 'DreamMe Batch2 UGC Test (SKAN)')
   on conflict (network, source_identifier) do update
     set meta_campaign_id = excluded.meta_campaign_id,
         meta_campaign_name = excluded.meta_campaign_name,
         updated_at = now();
   ```
4. New postbacks map immediately (60s decode cache). Historical rows keep their
   original `mapped_campaign_id` unless you backfill:
   ```sql
   update public.skan_postbacks p
   set mapped_campaign_id = m.meta_campaign_id, mapped_campaign_name = m.meta_campaign_name
   from public.skan_campaign_mapping m
   where p.source_identifier = m.source_identifier and p.mapped_campaign_id is null;
   ```

> **Keep this table current as campaigns change.** When you launch/rename a Meta
> campaign, add/adjust its source-identifier row here once it shows up in
> postbacks. This is ongoing upkeep, by design isolated to one table.

---

## Signature verification

- **SKAdNetwork:** fully verified. We rebuild Apple's version-specific signed
  string (fields joined by the invisible `U+2063` separator), SHA-256 it, and
  ECDSA-verify the base64 `attribution-signature` against Apple's production
  **P-256** public key. Versions 2.1 / 2.2 / 3.0 / 4.0 supported; 1.0 / 2.0
  (P-192) are flagged `unsupported_version`. Verified against Apple's real
  worked-example vectors in `tests/skan-verify.test.ts`.
- **AdAttributionKit:** newer AAK postbacks are migrating to a **JWS**-signed
  token whose key/format Apple hasn't stabilized for us to pin. AAK postbacks
  are stored + decoded but flagged **`unverified_aak`** (and therefore **not
  counted**) unless they happen to verify under the SKAN scheme. Revisit once
  Apple's AAK key/format is confirmed.

`signature_status` values: `valid` · `invalid` · `unverified_aak` ·
`unsupported_version` · `error`. **Only `valid` + `did-win` postbacks are
counted** in `skan_campaign_efficiency` — invalid ones are still stored for
audit so nobody can spoof fake trials into the numbers.

De-dupe: a device can resend a window. The partial unique index on
`(network, transaction-id, postback-sequence-index)` makes resends idempotent
(reported as `duplicate`, counted once).

---

## What the dashboard shows

In **Marketing Efficiency → First-party SKAN**:

- **Blended CAC · 35d** = Meta spend ÷ RevenueCat trials (the causal-sanity
  number we trust most — works today, before any postbacks).
- **RC trials · 35d**, **SKAN trials decoded**, **SKAN coverage** (= SKAN ÷ RC,
  i.e. how much SKAN under-counts).
- Per-campaign table: spend, SKAN trials, cost/trial, SKAN subs, cost/sub, and
  the **P1·P2·P3** trial window split.
- **Nulls are shown as `—` and are distinct from a real `0`** (privacy-nulled,
  not "no conversions").

---

## Environment variables

All already present for the rest of the app — the collector adds none:

- `NEXT_PUBLIC_SUPABASE_URL`
- `DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) — the
  collector writes the RLS-locked `skan_postbacks` table.

---

## Manually testing the collector

Replay a real Apple worked-example postback (valid signature) against prod:

```bash
curl -sS -X POST \
  'https://dreamme-admin-dash.vercel.app/skan/.well-known/skadnetwork/report-attribution/' \
  -H 'Content-Type: application/json' \
  -d '{"version":"4.0","ad-network-id":"com.example","source-identifier":"5239","app-id":525463029,"transaction-id":"6aafb7a5-0170-41b5-bbe4-fe71dedf1e30","redownload":false,"source-domain":"example.com","fidelity-type":1,"did-win":true,"conversion-value":63,"postback-sequence-index":0,"attribution-signature":"MEUCIGRmSMrqedNu6uaHyhVcifs118R5z/AB6cvRaKrRRHWRAiEAv96ne3dKQ5kJpbsfk4eYiePmrZUU6sQmo+7zfP/1Bxo="}'
# => {"ok":true,"signature_status":"valid","decoded_event":"purchase","stored":"stored", ...}
```

(`source-identifier` 5239 is unmapped, so it lands as Unattributed until you add
a `skan_campaign_mapping` row — that's expected.) Re-POSTing the same body
returns `"stored":"duplicate"`.

---

## Hard caveats (do not over-promise)

- We **cannot** beat Apple's privacy threshold — low-volume campaigns return
  without a source-identifier. SKAN currently splits installs across multiple
  campaigns; consolidating into fewer campaigns helps clear the threshold.
- Per-campaign SKAN data is **aggregated, delayed 24–72h**, and approximate.
  Use it to **rank** campaigns; use RevenueCat + blended CAC for absolute truth.
- This complements (does not replace) the per-trial → RevenueCat attribution
  effort in [`attribution-handoff.md`](./attribution-handoff.md); that wires
  ad-level `campaign_id` into RC for ATT-allowed users. SKAN covers the ~89%
  ATT-denied majority at campaign granularity.

---

## Files

| Path | Purpose |
| ---- | ------- |
| `supabase/migrations/0031_skan_attribution.sql` | tables, CV-schema seed, views |
| `src/lib/skan/verify.ts` | Apple ECDSA signature verification |
| `src/lib/skan/decode.ts` | field extraction + CV/source decode |
| `src/lib/skan/server.ts` | service-role storage + de-dupe |
| `src/lib/skan/handler.ts` | shared collect logic (verify → decode → store) |
| `src/app/api/skan/skadnetwork/route.ts` | SKAdNetwork postback POST |
| `src/app/api/skan/adattributionkit/route.ts` | AdAttributionKit postback POST |
| `src/app/api/skan/collect/route.ts` | `GET /skan` status + POST fallback |
| `next.config.ts` | well-known path rewrites (+ skipTrailingSlashRedirect) |
| `src/components/MarketingEfficiency.tsx` | dashboard "First-party SKAN" section |
| `tests/skan-verify.test.ts` | signature + decode regression vectors |
