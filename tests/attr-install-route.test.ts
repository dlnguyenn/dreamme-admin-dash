import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The install ingest end to end: POST /api/attr/install with Supabase
 * stubbed at fetch. Pins what actually goes over the wire for an Android
 * ping with install referrers, and that iOS pings are untouched by them.
 */

const SUPABASE = "https://internal.supabase.test";
const TOKEN = "sdk-token-for-tests";
const KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const CLICK_ID = "3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b";
const INSTALL_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const META_PAYLOAD = {
  adgroup_id: "120230000000000003",
  campaign_id: "120230000000000002",
  campaign_group_id: "120230000000000001",
  account_id: "act_1234567890",
};

function encrypted(payload: object) {
  const nonce = "b7203c6a6fb633d16e9cf5c1";
  const c = createCipheriv("aes-256-gcm", Buffer.from(KEY, "hex"), Buffer.from(nonce, "hex"));
  const body = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return { data: Buffer.concat([body, c.getAuthTag()]).toString("hex"), nonce };
}

const ANDROID = {
  install_id: INSTALL_ID,
  first_open_at: "2026-11-05T18:30:00.000Z",
  platform: "android",
  os_version: "36",
  device_model: "Pixel 9",
  locale: "en-US",
  timezone: "America/Chicago",
  screen_w: 412,
  screen_h: 915,
  screen_scale: 2.625,
  app_version: "1.5.6",
  sdk_version: "3",
};

const IOS = {
  install_id: INSTALL_ID,
  first_open_at: "2026-11-05T18:30:00.000Z",
  platform: "ios",
  os_version: "26.1",
  device_model: "iPhone17,2",
  locale: "en-US",
  timezone: "America/Los_Angeles",
  screen_w: 393,
  screen_h: 852,
  screen_scale: 3,
  idfv: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
  app_version: "1.5.6",
  att_status: "denied",
  sdk_version: "3",
};

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

type Call = { method: string; url: string; body: Record<string, unknown> | null };

/** Stand-in for PostgREST. `clicks` answers attr_clicks reads; `reject`
 *  may refuse a write (returns a Response) to simulate an unapplied migration. */
function stubSupabase(opts: {
  clicks?: (url: string) => unknown[];
  reject?: (call: Call) => Response | null;
}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      const refused = opts.reject?.(call);
      if (refused) return refused;
      if (call.method === "GET") return Response.json(opts.clicks?.(call.url) ?? []);
      return new Response(null, { status: call.method === "POST" ? 201 : 204 });
    }),
  );
  return calls;
}

const unknownColumn = () =>
  Response.json(
    { code: "PGRST204", message: "Could not find the 'install_referrer' column of 'attr_installs' in the schema cache" },
    { status: 400 },
  );

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/attr/install/route");
  return POST(
    new Request("https://outlier.test/api/attr/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "okhttp/4.12.0",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

const upserts = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.url.includes("/attr_installs"));
const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH" && c.url.includes("/attr_installs"));

beforeEach(() => {
  vi.resetModules(); // the Supabase URL and key are read at module load
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY", "service-role");
  vi.stubEnv("ATTR_SDK_TOKEN", TOKEN);
  vi.stubEnv("META_INSTALL_REFERRER_KEY", KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/attr/install with Android install referrers", () => {
  it("our ad link: stores the referrer, fetches the named click by id, records play_referrer", async () => {
    const calls = stubSupabase({
      // the named click is on another network: only the by-id read returns it
      clicks: (url) =>
        url.includes(`click_id=eq.${CLICK_ID}`)
          ? [{ click_id: CLICK_ID, clicked_at: "2026-11-05T18:20:00.000Z", ip: "198.51.100.9", platform_hint: "android", fbclid: null, ua: null }]
          : [],
    });
    const res = await post({
      ...ANDROID,
      install_referrer: {
        referrer: `utm_source=dreamme_link&dm_click=${CLICK_ID}`,
        click_ts: 1793903300,
        install_begin_ts: 1793903340,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, match: "matched" });

    const [upsert] = upserts(calls);
    expect(upsert.body).toMatchObject({
      install_id: INSTALL_ID,
      platform: "android",
      install_referrer: `utm_source=dreamme_link&dm_click=${CLICK_ID}`,
      referrer_click_id: CLICK_ID,
      referrer_click_at: "2026-11-05T18:28:20.000Z",
      install_begin_at: "2026-11-05T18:29:00.000Z",
      ref_source: null,
      ref_campaign_id: null,
    });
    // raw keeps the object exactly as sent: the DAD counts raw ? 'install_referrer'
    expect((upsert.body!.raw as Record<string, unknown>).install_referrer).toEqual({
      referrer: `utm_source=dreamme_link&dm_click=${CLICK_ID}`,
      click_ts: 1793903300,
      install_begin_ts: 1793903340,
    });

    const [patch] = patches(calls);
    expect(patch.url).toContain(`install_id=eq.${INSTALL_ID}`);
    expect(patch.url).toContain("or=(match_method.is.null,match_method.not.in.(play_referrer,meta_referrer))");
    expect(patch.body).toMatchObject({
      matched_click_id: CLICK_ID,
      match_method: "play_referrer",
      match_confidence: "high",
    });
  });

  it("a Meta view-through: decrypts the Meta referrer and records meta_referrer with the ad ids, no click", async () => {
    const calls = stubSupabase({});
    const res = await post({
      ...ANDROID,
      install_referrer: { referrer: "utm_source=google-play&utm_medium=organic", click_ts: 0, install_begin_ts: 1793903340 },
      meta_install_referrer: {
        install_referrer: JSON.stringify({
          utm_campaign: "fb4a",
          utm_content: { source: encrypted(META_PAYLOAD), a: 1214186473920093, t: 1793903000 },
          utm_source: "apps.instagram.com",
        }),
        actual_timestamp: 1793903000,
        is_ct: 0,
        source: "instagram",
      },
    });
    expect(await res.json()).toEqual({ ok: true, match: "matched" });

    expect(upserts(calls)[0].body).toMatchObject({
      meta_referrer_app: "instagram",
      meta_referrer_is_ct: false,
      meta_referrer_at: "2026-11-05T18:23:20.000Z",
      ref_source: "meta_referrer",
      ref_campaign_id: "120230000000000001",
      ref_adset_id: "120230000000000002",
      ref_ad_id: "120230000000000003",
      ref_account_id: "1234567890",
      ref_decoded: { meta: META_PAYLOAD },
    });
    expect(patches(calls)[0].body).toMatchObject({
      matched_click_id: null,
      match_method: "meta_referrer",
      match_confidence: "high",
      ref_campaign_id: "120230000000000001",
    });
  });

  it("no decryption key yet: the install is stored with the encrypted referrer and falls back to the IP match", async () => {
    vi.stubEnv("META_INSTALL_REFERRER_KEY", "");
    const calls = stubSupabase({});
    const res = await post({
      ...ANDROID,
      meta_install_referrer: {
        install_referrer: JSON.stringify({ utm_content: { source: encrypted(META_PAYLOAD) } }),
        is_ct: 1,
        source: "facebook",
      },
    });
    expect(await res.json()).toEqual({ ok: true, match: "unmatched" });
    const [upsert] = upserts(calls);
    expect(upsert.body).toMatchObject({ meta_referrer_app: "facebook", meta_referrer_is_ct: true, ref_campaign_id: null });
    expect(upsert.body!.raw).toHaveProperty("meta_install_referrer");
    expect(patches(calls)).toHaveLength(0);
  });

  it("migration not applied: the upsert and the verdict both retry without the referrer columns and the ping is still acked", async () => {
    const calls = stubSupabase({
      reject: (c) => (c.method !== "GET" && c.body && "ref_source" in c.body ? unknownColumn() : null),
    });
    const res = await post({
      ...ANDROID,
      meta_install_referrer: {
        install_referrer: JSON.stringify({ utm_content: { source: encrypted(META_PAYLOAD) } }),
        is_ct: 1,
        source: "facebook",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, match: "matched" });

    const [first, retry] = upserts(calls);
    expect(first.body).toHaveProperty("ref_campaign_id");
    expect(retry.body).not.toHaveProperty("ref_campaign_id");
    expect(retry.body).not.toHaveProperty("install_referrer");
    expect(retry.body).toMatchObject({ install_id: INSTALL_ID, platform: "android" });
    expect(retry.body!.raw).toHaveProperty("meta_install_referrer"); // nothing is lost

    const [, verdict] = patches(calls);
    expect(verdict.body).toEqual({
      matched_click_id: null,
      match_method: "meta_referrer",
      match_confidence: "high",
      updated_at: expect.any(String),
    });
  });

  it("a malformed referrer never costs the install: 200, stored without it, raw keeps what was sent", async () => {
    const calls = stubSupabase({});
    const res = await post({ ...ANDROID, install_referrer: { referrer: "x", click_ts: 1793903300000 } });
    expect(res.status).toBe(200);
    const [upsert] = upserts(calls);
    expect(upsert.body).not.toHaveProperty("install_referrer");
    expect((upsert.body!.raw as Record<string, unknown>).install_referrer).toEqual({ referrer: "x", click_ts: 1793903300000 });
  });

  it("a NUL inside a referrer is stripped before it can fail the write", async () => {
    const calls = stubSupabase({});
    const res = await post({ ...ANDROID, install_referrer: { referrer: `utm_source=x${String.fromCharCode(0)}y` } });
    expect(res.status).toBe(200);
    expect(upserts(calls)[0].body).toMatchObject({ install_referrer: "utm_source=xy" });
    expect(JSON.stringify(upserts(calls)[0].body)).not.toContain("u0000");
  });
});

describe("POST /api/attr/install without referrers (iOS, older Android builds)", () => {
  it("writes exactly the columns it wrote before this change, and matches by IP as before", async () => {
    const calls = stubSupabase({
      clicks: () => [
        { click_id: "ip-click", clicked_at: "2026-11-05T18:10:00.000Z", ip: "203.0.113.7", platform_hint: "ios", fbclid: null, ua: SAFARI },
      ],
    });
    const res = await post(IOS);
    expect(await res.json()).toEqual({ ok: true, match: "matched" });

    expect(upserts(calls)).toHaveLength(1);
    expect(Object.keys(upserts(calls)[0].body!).sort()).toEqual(
      [
        "install_id", "first_open_at", "app_user_id", "platform", "os_version", "device_model", "locale", "timezone",
        "screen_w", "screen_h", "screen_scale", "idfv", "app_version", "launch_url", "fbclid", "deferred_link",
        "att_status", "ip", "ua", "raw", "updated_at",
      ].sort(),
    );
    // no by-id click read: only the IP neighbourhood
    expect(calls.filter((c) => c.method === "GET" && c.url.includes("click_id=eq."))).toHaveLength(0);

    const [patch] = patches(calls);
    expect(patch.url).toContain("matched_click_id=is.null&match_method=is.null");
    expect(patch.body).toEqual({
      matched_click_id: "ip-click",
      match_method: "exact_ip",
      match_confidence: "high",
      updated_at: expect.any(String),
    });
  });

  it("still answers 401 for a bad token and 503 when the ingest is unconfigured", async () => {
    stubSupabase({});
    expect((await post(IOS, { authorization: "Bearer wrong" })).status).toBe(401);
    vi.stubEnv("ATTR_SDK_TOKEN", "");
    expect((await post(IOS)).status).toBe(503);
  });
});
