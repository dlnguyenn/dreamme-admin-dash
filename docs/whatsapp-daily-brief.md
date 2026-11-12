# WhatsApp daily brief

Every morning (~7-8am ET) the DAD sends a WhatsApp message with yesterday's
trials, revenue, ad spend and MRR, the Overview's "Needs attention" items and
what the experiment log wants a look at.

- Builder (pure, tested): `src/lib/daily-brief.ts`, `tests/daily-brief.test.ts`
- Sender: `src/lib/vendors/whatsapp.ts` (WhatsApp Cloud API, Meta)
- Cron: `/api/cron/daily-brief`, `vercel.json` at `0 12 * * *` (Hobby crons fire
  somewhere in that hour). `?dry=1` returns the message without sending.

The numbers come from `buildOverview()`, so they match the Overview exactly:
trials = RevenueCat (`rc_trial_starts_daily`), revenue = charges minus refunds
by Eastern day, spend = live Meta read, MRR = `rc_account_metrics_daily`.

## Why a template

WhatsApp only lets a business start a conversation with an approved template.
Free text only works within 24h of you messaging the number. Template values
can't contain line breaks, so each line of the brief is its own value and
lists inside a value are joined with " · ".

## One-time setup

1. **Meta app**: in developers.facebook.com, open the DreamMe app (or create a
   Business app) and add the **WhatsApp** product. Meta gives you a free test
   number that can message up to 5 numbers you verify. That is enough for this.
2. **Add your phone as a recipient**: WhatsApp > API Setup > "To" > add your
   number and enter the code WhatsApp sends you.
3. **Create the template**: WhatsApp Manager > Message templates > Create.
   Category **Utility**, name `daily_brief`, language **English (US)**, body:

   ```
   DreamMe daily brief for {{1}}

   Trials: {{2}}
   Revenue: {{3}}
   Ad spend: {{4}}
   MRR: {{5}}

   Needs you: {{6}}

   Experiments: {{7}}

   Full numbers are on the DAD Overview.
   ```

   Sample values for review: `Wed Nov 11`, `64 · 7d avg 69 (-7%)`,
   `$1,240 · 7d avg $1,180`, `$410 · $9.30 per Meta trial · 7d avg $395`,
   `$38.2k · +$120 yesterday · +4.1% in 30d`, `nothing urgent`,
   `Monthly $19.99 vs $14.99 day 2`.
4. **Permanent token**: Business Settings > System users > add (or reuse) a
   system user, give it the app and the WhatsApp account, and generate a token
   with `whatsapp_business_messaging` and `whatsapp_business_management`, set
   to never expire. (The API Setup page's token expires after 24h.)
5. **Vercel env (Production)**:
   - `WHATSAPP_TOKEN`: the system-user token
   - `WHATSAPP_PHONE_NUMBER_ID`: from API Setup ("Phone number ID")
   - `WHATSAPP_BRIEF_TO`: your number with country code, digits only
     (e.g. `1555…`); comma-separate for more than one person
   - optional `WHATSAPP_BRIEF_TEMPLATE` (default `daily_brief`) and
     `WHATSAPP_BRIEF_LANG` (default `en_US`)
6. Redeploy, then test once:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://dreamme-admin-dash.vercel.app/api/cron/daily-brief`

Later, to send from a real DreamMe number instead of the test number, add a
number in WhatsApp Manager (it can't be on a personal WhatsApp account) and
swap `WHATSAPP_PHONE_NUMBER_ID`.

## Cost

Meta charges per template message sent (utility rate, US: a fraction of a
cent to about a cent). One a day is well under $1/month.

## Errors you may see

- `(131030)` recipient not in the test number's allowed list: step 2.
- `(132001)` template doesn't exist or isn't approved yet: step 3, or the
  name/language env vars don't match.
- `(132000)` parameter count mismatch: the template body must have exactly
  `{{1}}`..`{{7}}`.
- `(190)` token expired: step 4 (use a system-user token, not the 24h one).
