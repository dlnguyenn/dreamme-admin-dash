import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCapiEvent,
  buildFbc,
  buildLogRow,
  chunk,
  classify,
  eventNamesFor,
  hashEmail,
  hashExternalId,
  logKey,
  qualifyMinutes,
  selectConversions,
  selectInstallConversions,
  EVENT_SOURCE_URL,
  MAX_EVENT_AGE_MS,
  SHARED_DATASET_ID,
  SHARED_NAMES,
  STANDARD_NAMES,
  type CapiClick,
  type CapiInstall,
  type CapiRcEvent,
} from "@/lib/attr-capi";

/**
 * Contract-first suite for attribution phase 3a — the CAPI forwarder.
 * The core is pure ((installs, clicks, rc_events, logged) -> conversions ->
 * payloads), so every rule about what reaches Meta is enumerable here:
 *   selection (joins, confidence floor, first-paid-only, production-only,
 *   max age), fbc construction, hashing, idempotency, batching, log rows.
 */

const NOW = Date.parse("2026-09-22T12:00:00Z");

const click = (o: Partial<CapiClick> = {}): CapiClick => ({
  click_id: "c1",
  clicked_at: "2026-09-21T10:00:00.000Z",
  ip: "203.0.113.7",
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) FBAN/FBIOS",
  fbclid: "IwARabc123",
  fbp: "fb.2.1758448800000.1234567890",
  media_source: "meta",
  campaign_id: "120210001",
  ad_id: "120210003",
  ...o,
});

const install = (o: Partial<CapiInstall> = {}): CapiInstall => ({
  install_id: "11111111-2222-4333-8444-555555555555",
  first_open_at: "2026-09-21T10:10:00.000Z",
  app_user_id: "u1",
  matched_click_id: "c1",
  match_confidence: "high",
  ...o,
});

const rc = (o: Partial<CapiRcEvent> = {}): CapiRcEvent => ({
  id: "e1",
  type: "INITIAL_PURCHASE",
  period_type: "TRIAL",
  environment: "PRODUCTION",
  event_at: "2026-09-21T10:30:00.000Z",
  app_user_id: "u1",
  dm_install_id: "11111111-2222-4333-8444-555555555555",
  original_transaction_id: "otid-1",
  price_usd: 0,
  ...o,
});

const select = (
  installs: CapiInstall[],
  clicks: CapiClick[],
  events: CapiRcEvent[],
  logged = new Set<string>(),
) => selectConversions(installs, clicks, events, logged, { now: NOW });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ── classification ─────────────────────────────────────────────────────

describe("classify", () => {
  it("maps trial starts and paid starts, ignores everything else", () => {
    expect(classify(rc())).toBe("trial");
    expect(classify(rc({ period_type: "NORMAL" }))).toBe("subscribe");
    expect(classify(rc({ type: "RENEWAL", period_type: "NORMAL" }))).toBe("subscribe");
    expect(classify(rc({ type: "RENEWAL", period_type: "TRIAL" }))).toBeNull();
    expect(classify(rc({ type: "CANCELLATION", period_type: "NORMAL" }))).toBeNull();
    expect(classify(rc({ type: "PRODUCT_CHANGE", period_type: "NORMAL" }))).toBeNull();
  });

  it("never forwards sandbox events", () => {
    expect(classify(rc({ environment: "SANDBOX" }))).toBeNull();
    expect(classify(rc({ environment: null }))).toBeNull();
  });
});

// ── selection ──────────────────────────────────────────────────────────

describe("selectConversions", () => {
  it("forwards an attributed trial: install via dm_install_id, click via matched_click_id", () => {
    const out = select([install()], [click()], [rc()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      event_name: "attr_start_trial",
      event_id: "otid-1",
      event_at: "2026-09-21T10:30:00.000Z",
    });
    expect(out[0].click.click_id).toBe("c1");
    expect(out[0].install.install_id).toBe(install().install_id);
  });

  it("falls back to app_user_id when the event carries no dm_install_id (pre-3b events)", () => {
    const out = select([install()], [click()], [rc({ dm_install_id: null })]);
    expect(out).toHaveLength(1);
  });

  it("prefers the dm_install_id join over a different install under the same user", () => {
    const other = install({ install_id: "22222222-2222-4222-8222-222222222222", matched_click_id: "c2" });
    const out = select(
      [other, install()],
      [click(), click({ click_id: "c2", ad_id: "other-ad" })],
      [rc()],
    );
    expect(out).toHaveLength(1);
    expect(out[0].click.click_id).toBe("c1");
  });

  it("drops installs with no match or below the confidence floor", () => {
    expect(select([install({ matched_click_id: null })], [click()], [rc()])).toHaveLength(0);
    expect(select([install({ match_confidence: "low" })], [click()], [rc()])).toHaveLength(0);
    expect(select([install({ match_confidence: "medium" })], [click()], [rc()])).toHaveLength(1);
  });

  it("drops events whose click row is missing, and events with no install at all", () => {
    expect(select([install()], [], [rc()])).toHaveLength(0);
    expect(select([], [click()], [rc()])).toHaveLength(0);
    expect(
      select([install({ app_user_id: "someone-else" })], [click()], [rc({ dm_install_id: null })]),
    ).toHaveLength(0);
  });

  it("requires an original_transaction_id (it is the event_id)", () => {
    expect(select([install()], [click()], [rc({ original_transaction_id: null })])).toHaveLength(0);
  });

  it("sends attr_subscribe for the FIRST paid start only — later renewals never qualify", () => {
    const firstPaid = rc({ id: "e2", type: "RENEWAL", period_type: "NORMAL", event_at: "2026-09-21T11:00:00.000Z", price_usd: 69.99 });
    const laterRenewal = rc({ id: "e3", type: "RENEWAL", period_type: "NORMAL", event_at: "2026-09-22T11:00:00.000Z", price_usd: 69.99 });
    const out = select([install()], [click()], [laterRenewal, firstPaid, rc()]);
    expect(out.map((c) => [c.event_name, c.rc?.id])).toEqual([
      ["attr_start_trial", "e1"],
      ["attr_subscribe", "e2"],
    ]);
  });

  it("treats the paid history as authoritative: a first paid start older than 7 days blocks the renewal", () => {
    // The route fetches each subscription's whole NORMAL history; if the
    // real first paid start is too old to send, nothing is sent (never the
    // renewal in its place).
    const oldFirstPaid = rc({ id: "e2", type: "INITIAL_PURCHASE", period_type: "NORMAL", event_at: "2026-08-01T11:00:00.000Z" });
    const renewal = rc({ id: "e3", type: "RENEWAL", period_type: "NORMAL", event_at: "2026-09-21T11:00:00.000Z" });
    expect(select([install()], [click()], [oldFirstPaid, renewal])).toHaveLength(0);
  });

  it("collapses rc_events re-sends of the same event to one conversion (earliest wins)", () => {
    const resend = rc({ id: "e1-resend", event_at: "2026-09-21T10:31:00.000Z" });
    const out = select([install()], [click()], [resend, rc()]);
    expect(out).toHaveLength(1);
    expect(out[0].rc?.id).toBe("e1");
  });

  it("is idempotent: conversions already in the log are not selected again", () => {
    const first = select([install()], [click()], [rc()]);
    const logged = new Set(first.map((c) => logKey(c.event_name, c.event_id)));
    expect(select([install()], [click()], [rc()], logged)).toHaveLength(0);
  });

  it("keys the log per event name, so a trial and its conversion share an otid without colliding", () => {
    const paid = rc({ id: "e2", type: "RENEWAL", period_type: "NORMAL", event_at: "2026-09-21T11:00:00.000Z" });
    const logged = new Set([logKey("attr_start_trial", "otid-1")]);
    const out = select([install()], [click()], [rc(), paid], logged);
    expect(out.map((c) => c.event_name)).toEqual(["attr_subscribe"]);
  });

  it("drops events older than Meta's 7-day event_time limit", () => {
    const tooOld = rc({ event_at: new Date(NOW - MAX_EVENT_AGE_MS - 1000).toISOString() });
    const justInside = rc({ event_at: new Date(NOW - MAX_EVENT_AGE_MS + 60_000).toISOString() });
    expect(select([install()], [click()], [tooOld])).toHaveLength(0);
    expect(select([install()], [click()], [justInside])).toHaveLength(1);
  });

  it("orders output oldest-first for stable batches", () => {
    const a = rc({ id: "a", original_transaction_id: "otid-a", event_at: "2026-09-21T12:00:00.000Z" });
    const b = rc({ id: "b", original_transaction_id: "otid-b", event_at: "2026-09-21T09:00:00.000Z" });
    const out = select([install()], [click()], [a, b]);
    expect(out.map((c) => c.event_id)).toEqual(["otid-b", "otid-a"]);
  });
});

// ── fbc ────────────────────────────────────────────────────────────────

describe("buildFbc", () => {
  it("formats fb.1.<clicked_at ms>.<fbclid>, never hashed", () => {
    expect(buildFbc({ clicked_at: "2026-09-21T10:00:00.000Z", fbclid: "IwARabc123" })).toBe(
      `fb.1.${Date.parse("2026-09-21T10:00:00.000Z")}.IwARabc123`,
    );
  });

  it("returns null without an fbclid or with an unparsable timestamp", () => {
    expect(buildFbc({ clicked_at: "2026-09-21T10:00:00.000Z", fbclid: null })).toBeNull();
    expect(buildFbc({ clicked_at: "yesterday", fbclid: "IwAR" })).toBeNull();
  });
});

// ── hashing ────────────────────────────────────────────────────────────

describe("hashing", () => {
  it("hashes email as sha256(lowercase(trim))", () => {
    expect(hashEmail("  Dan@Example.COM ")).toBe(sha("dan@example.com"));
    expect(hashEmail("dan@example.com")).toHaveLength(64);
  });

  it("hashes external_id trimmed but case-preserved", () => {
    expect(hashExternalId(" ABC-123 ")).toBe(sha("ABC-123"));
  });
});

// ── payload ────────────────────────────────────────────────────────────

describe("buildCapiEvent", () => {
  const conv = () => select([install()], [click()], [rc({ price_usd: 0 })])[0];

  it("builds a website event with click signals, hashed email and external_id", () => {
    const ev = buildCapiEvent(conv(), "Dan@Example.com");
    expect(ev).toEqual({
      event_name: "attr_start_trial",
      event_time: Math.floor(Date.parse("2026-09-21T10:30:00.000Z") / 1000),
      event_id: "otid-1",
      action_source: "website",
      event_source_url: EVENT_SOURCE_URL,
      user_data: {
        fbc: `fb.1.${Date.parse("2026-09-21T10:00:00.000Z")}.IwARabc123`,
        fbp: "fb.2.1758448800000.1234567890",
        client_ip_address: "203.0.113.7",
        client_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) FBAN/FBIOS",
        em: [sha("dan@example.com")],
        external_id: [sha("u1")],
      },
      // trials carry no value (only revenue events do)
      custom_data: {
        campaign_id: "120210001",
        ad_id: "120210003",
        match_confidence: "high",
      },
    });
  });

  it("omits em / fbc / fbp when unavailable instead of sending empties", () => {
    const c = select([install()], [click({ fbclid: null, fbp: null })], [rc()])[0];
    const ev = buildCapiEvent(c, null);
    expect(ev.user_data).not.toHaveProperty("em");
    expect(ev.user_data).not.toHaveProperty("fbc");
    expect(ev.user_data).not.toHaveProperty("fbp");
    expect(ev.user_data.client_ip_address).toBe("203.0.113.7");
    expect(ev.user_data.client_user_agent).toContain("iPhone");
  });

  it("carries the paid price + currency on the paid start, 0 when price is missing", () => {
    const paidEv = (price: number | null) =>
      select([install()], [click()], [rc({ id: "e2", type: "RENEWAL", period_type: "NORMAL", price_usd: price })])[0];
    expect(buildCapiEvent(paidEv(69.99), null).custom_data).toMatchObject({ currency: "USD", value: 69.99 });
    expect(buildCapiEvent(paidEv(null), null).custom_data.value).toBe(0);
  });

  it("sends installs as Lead with no value, event_time = first open, no external_id before sign-up", () => {
    const c = selectInstallConversions([install({ app_user_id: null })], [click()], new Set(), { now: NOW })[0];
    const ev = buildCapiEvent(c, null);
    expect(ev).toMatchObject({
      event_name: "Lead",
      event_id: install().install_id,
      event_time: Math.floor(Date.parse("2026-09-21T10:10:00.000Z") / 1000),
    });
    expect(ev.custom_data).not.toHaveProperty("value");
    expect(ev.custom_data).not.toHaveProperty("currency");
    expect(ev.user_data).not.toHaveProperty("external_id");
    expect(ev.user_data.fbp).toBe("fb.2.1758448800000.1234567890");
  });
});

// ── batching + log rows ────────────────────────────────────────────────

describe("chunk / buildLogRow", () => {
  it("splits into batches of at most 1000", () => {
    const items = Array.from({ length: 2001 }, (_, i) => i);
    const batches = chunk(items);
    expect(batches.map((b) => b.length)).toEqual([1000, 1000, 1]);
    expect(chunk([])).toEqual([]);
  });

  it("log rows have a uniform shape keyed by (event_name, event_id)", () => {
    const c = select([install()], [click()], [rc()])[0];
    const row = buildLogRow(c, SHARED_DATASET_ID, "sent", { events_received: 1, fbtrace_id: "AbC" });
    expect(row).toEqual({
      dataset_id: SHARED_DATASET_ID,
      event_id: "otid-1",
      event_name: "attr_start_trial",
      install_id: install().install_id,
      click_id: "c1",
      app_user_id: "u1",
      status: "sent",
      meta_response: { events_received: 1, fbtrace_id: "AbC" },
    });
    expect(buildLogRow(c, "999", "send_failed", undefined).meta_response).toBeNull();
  });
});

// ── trial qualification (Appstack's "did not cancel within the window") ──

describe("trial qualification", () => {
  const MIN = 60_000;
  const trialAt = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const cancel = (at: string) =>
    rc({ id: `x-${at}`, type: "CANCELLATION", period_type: "TRIAL", event_at: at });

  it("holds a trial until the 120-minute window has passed", () => {
    expect(select([install()], [click()], [rc({ event_at: trialAt(119 * MIN) })])).toHaveLength(0);
    expect(select([install()], [click()], [rc({ event_at: trialAt(121 * MIN) })])).toHaveLength(1);
  });

  it("never sends a trial cancelled inside the window (the 5-minute cancel case)", () => {
    const start = trialAt(10 * 60 * MIN);
    const fiveMinLater = new Date(Date.parse(start) + 5 * MIN).toISOString();
    expect(select([install()], [click()], [rc({ event_at: start }), cancel(fiveMinLater)])).toHaveLength(0);
  });

  it("still sends a trial cancelled after the window closed", () => {
    const start = trialAt(10 * 60 * MIN);
    const threeHoursLater = new Date(Date.parse(start) + 180 * MIN).toISOString();
    expect(select([install()], [click()], [rc({ event_at: start }), cancel(threeHoursLater)])).toHaveLength(1);
  });

  it("only gates trials: a cancellation never blocks the paid start", () => {
    const paid = rc({ id: "e2", type: "INITIAL_PURCHASE", period_type: "NORMAL", event_at: trialAt(60 * MIN) });
    const out = select([install()], [click()], [paid, cancel(trialAt(30 * MIN))]);
    expect(out.map((c) => c.kind)).toEqual(["subscribe"]);
  });

  it("honors a custom window", () => {
    const fresh = rc({ event_at: trialAt(45 * MIN) });
    const out = selectConversions([install()], [click()], [fresh], new Set(), { now: NOW, qualifyMs: 30 * MIN });
    expect(out).toHaveLength(1);
  });

  it("clamps ATTR_TRIAL_QUALIFY_MINUTES to Appstack's 30..1440 range, default 120", () => {
    expect(qualifyMinutes(undefined)).toBe(120);
    expect(qualifyMinutes("abc")).toBe(120);
    expect(qualifyMinutes("5")).toBe(30);
    expect(qualifyMinutes("90")).toBe(90);
    expect(qualifyMinutes("5000")).toBe(1440);
  });
});

// ── dataset-dependent event names ──────────────────────────────────────

describe("eventNamesFor", () => {
  it("keeps our own trial/paid names on the shared dataset (RevenueCat posts StartTrial there)", () => {
    expect(eventNamesFor(SHARED_DATASET_ID)).toEqual(SHARED_NAMES);
    expect(SHARED_NAMES).toEqual({ install: "Lead", trial: "attr_start_trial", subscribe: "attr_subscribe" });
  });

  it("uses Meta's standard names on a dedicated attributed-only dataset", () => {
    expect(eventNamesFor("123456789")).toEqual(STANDARD_NAMES);
    expect(STANDARD_NAMES).toEqual({ install: "Lead", trial: "StartTrial", subscribe: "Subscribe" });
  });

  it("names conversions and checks the log with the target dataset's names", () => {
    const opts = { now: NOW, names: STANDARD_NAMES };
    const out = selectConversions([install()], [click()], [rc()], new Set(), opts);
    expect(out[0].event_name).toBe("StartTrial");
    // an attr_start_trial already sent to the shared dataset does not block the new one
    const loggedShared = new Set([logKey("attr_start_trial", "otid-1")]);
    expect(selectConversions([install()], [click()], [rc()], loggedShared, opts)).toHaveLength(1);
    const loggedHere = new Set([logKey("StartTrial", "otid-1")]);
    expect(selectConversions([install()], [click()], [rc()], loggedHere, opts)).toHaveLength(0);
  });
});

// ── install → Lead selection ───────────────────────────────────────────

describe("selectInstallConversions", () => {
  const sel = (installs: CapiInstall[], clicks: CapiClick[], logged = new Set<string>()) =>
    selectInstallConversions(installs, clicks, logged, { now: NOW });

  it("sends every high/medium matched install from a Meta link as Lead, keyed by install_id", () => {
    const out = sel([install(), install({ install_id: "i2", match_confidence: "medium" })], [click()]);
    expect(out.map((c) => [c.kind, c.event_name, c.event_id])).toEqual([
      ["install", "Lead", install().install_id],
      ["install", "Lead", "i2"],
    ]);
    expect(out[0].rc).toBeNull();
  });

  it("skips unmatched, low-confidence, and non-Meta (creator / test) clicks", () => {
    expect(sel([install({ matched_click_id: null })], [click()])).toHaveLength(0);
    expect(sel([install({ match_confidence: "low" })], [click()])).toHaveLength(0);
    expect(sel([install()], [click({ media_source: "creator" })])).toHaveLength(0);
    expect(sel([install()], [click({ media_source: null })])).toHaveLength(0);
    expect(sel([install()], [])).toHaveLength(0);
  });

  it("is idempotent per install and drops first opens older than 7 days", () => {
    expect(sel([install()], [click()], new Set([logKey("Lead", install().install_id)]))).toHaveLength(0);
    const old = new Date(NOW - MAX_EVENT_AGE_MS - 1000).toISOString();
    expect(sel([install({ first_open_at: old })], [click()])).toHaveLength(0);
  });

  it("sends a duplicated install row once", () => {
    expect(sel([install(), install()], [click()])).toHaveLength(1);
  });
});
