import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MetaReferrerBody,
  PlayReferrerBody,
  decryptMetaReferrer,
  encryptedSource,
  hasReferrerEvidence,
  metaAdIds,
  playReferrerParam,
  referrerClickId,
  referrerFieldsFrom,
  resolveReferrers,
} from "@/lib/attr-referrer";

/**
 * Contract suite for Android install referrers (src/lib/attr-referrer.ts).
 *
 * No real Meta payload exists yet (the first Android build that reads the
 * referrers is not released), so the encrypted fixtures are built here the
 * way Meta's guide describes: AES-256-GCM, hex key, hex nonce, hex data
 * with the 16-byte tag appended (libsodium's combined layout). The first
 * real row must be checked against this suite's assumptions: the tag
 * layout, and which payload field is the campaign / ad set / ad.
 */

const KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const OTHER_KEY = "ff".repeat(32);
const NONCE = "b7203c6a6fb633d16e9cf5c1"; // 12 bytes, the length in Meta's example

// Meta's legacy names: campaign_group = campaign, campaign = ad set, adgroup = ad.
const PAYLOAD = {
  ad_id: "120230000000000003",
  adgroup_id: "120230000000000003",
  adgroup_name: "Comic Sans fish",
  campaign_id: "120230000000000002",
  campaign_name: "US broad",
  campaign_group_id: "120230000000000001",
  campaign_group_name: "SCALING Campaign (Android)",
  account_id: "act_1234567890",
  ad_objective_name: "APP_INSTALLS",
  is_instagram: true,
  publisher_platform: "instagram",
  platform_position: "instagram_stories",
};

/** Encrypt the way Meta does. `tag: false` leaves the tag off, the other
 *  reading of Meta's guide. */
function encrypt(plaintext: string, { key = KEY, nonce = NONCE, tag = true } = {}) {
  const c = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(nonce, "hex"));
  const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const data = tag ? Buffer.concat([body, c.getAuthTag()]) : body;
  return { data: data.toString("hex"), nonce };
}

const SOURCE = encrypt(JSON.stringify(PAYLOAD));
const CLICK_ID = "3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b";

/** The Play referrer of a Meta app ad: a query string whose utm_content is JSON. */
const playMetaReferrer = (source = SOURCE) =>
  `utm_source=apps.facebook.com&utm_campaign=fb4a&utm_content=${JSON.stringify({ app: 1214186473920093, t: 1762300000, source })}`;
/** What the Facebook / Instagram provider returns: a JSON object. */
const metaProviderReferrer = (source = SOURCE) =>
  JSON.stringify({ utm_campaign: "fb4a", utm_content: { source, a: 1214186473920093, t: 1762300000 }, utm_source: "apps.instagram.com" });

describe("referrerClickId / playReferrerParam", () => {
  it("round-trips the click id /l puts in the Play URL", () => {
    const param = playReferrerParam(CLICK_ID);
    expect(param).toBe(`utm_source=dreamme_link&dm_click=${CLICK_ID}`);
    expect(referrerClickId(param)).toBe(CLICK_ID);
  });

  it("reads the id wherever it sits, lower-cased, even if still percent-encoded", () => {
    expect(referrerClickId(`dm_click=${CLICK_ID.toUpperCase()}&utm_source=dreamme_link`)).toBe(CLICK_ID);
    expect(referrerClickId(`utm_source%3Ddreamme_link%26dm_click%3D${CLICK_ID}`)).toBe(CLICK_ID);
  });

  it("returns null for organic, foreign or malformed referrers", () => {
    expect(referrerClickId("utm_source=google-play&utm_medium=organic")).toBeNull();
    expect(referrerClickId("dm_click=not-a-uuid")).toBeNull();
    expect(referrerClickId(`xdm_click=${CLICK_ID}`)).toBeNull();
    expect(referrerClickId(`dm_click=${CLICK_ID}0`)).toBeNull(); // not exactly a uuid
    expect(referrerClickId(null)).toBeNull();
    expect(playReferrerParam("nope")).toBeNull();
  });
});

describe("encryptedSource", () => {
  it("finds data and nonce in the Play query-string form", () => {
    expect(encryptedSource(playMetaReferrer())).toEqual(SOURCE);
  });

  it("finds them in the Meta provider's JSON form", () => {
    expect(encryptedSource(metaProviderReferrer())).toEqual(SOURCE);
  });

  it("tolerates percent-encoding and JSON nested as an escaped string", () => {
    expect(encryptedSource(encodeURIComponent(playMetaReferrer()))).toEqual(SOURCE);
    const nested = JSON.stringify({ utm_content: JSON.stringify({ source: SOURCE }) });
    expect(encryptedSource(nested)).toEqual(SOURCE);
  });

  it("returns null when there is nothing encrypted", () => {
    expect(encryptedSource("utm_source=google-play&utm_medium=organic")).toBeNull();
    expect(encryptedSource(`utm_source=dreamme_link&dm_click=${CLICK_ID}`)).toBeNull();
    expect(encryptedSource('{"utm_content":{"source":{"data":"zz","nonce":"00"}}}')).toBeNull(); // not hex
    expect(encryptedSource(null)).toBeNull();
  });
});

describe("decryptMetaReferrer", () => {
  it("decrypts and authenticates the tag-appended layout", () => {
    const out = decryptMetaReferrer(SOURCE, KEY);
    expect(out?.authenticated).toBe(true);
    expect(out?.payload).toEqual(PAYLOAD);
  });

  it("also reads a payload whose tag was trimmed (Meta's guide says both)", () => {
    const out = decryptMetaReferrer(encrypt(JSON.stringify(PAYLOAD), { tag: false }), KEY);
    expect(out?.authenticated).toBe(false);
    expect(out?.payload).toEqual(PAYLOAD);
  });

  it("returns null for the wrong key, a missing key, a malformed key, or junk data", () => {
    expect(decryptMetaReferrer(SOURCE, OTHER_KEY)).toBeNull();
    expect(decryptMetaReferrer(SOURCE, undefined)).toBeNull();
    expect(decryptMetaReferrer(SOURCE, "")).toBeNull();
    expect(decryptMetaReferrer(SOURCE, KEY.slice(2))).toBeNull(); // 31 bytes
    expect(decryptMetaReferrer(SOURCE, `${KEY.slice(0, 63)}M`)).toBeNull(); // not hex
    expect(decryptMetaReferrer({ data: "00".repeat(40), nonce: NONCE }, KEY)).toBeNull();
    expect(decryptMetaReferrer({ data: "abc", nonce: NONCE }, KEY)).toBeNull(); // odd-length hex
  });

  it("accepts a key pasted with surrounding whitespace", () => {
    expect(decryptMetaReferrer(SOURCE, `  ${KEY}\n`)?.payload).toEqual(PAYLOAD);
  });

  it("keeps 18-digit ids exact when Meta sends them as bare numbers", () => {
    // 120230000000000001 is past Number.MAX_SAFE_INTEGER: JSON.parse alone
    // would round it to ...000 and the install would join the wrong campaign
    const bare = '{"campaign_group_id":120230000000000001,"campaign_id":120230000000000002,"adgroup_id":120230000000000003}';
    const out = decryptMetaReferrer(encrypt(bare), KEY);
    expect(metaAdIds(out!.payload)).toMatchObject({
      campaign_id: "120230000000000001",
      adset_id: "120230000000000002",
      ad_id: "120230000000000003",
    });
  });
});

describe("metaAdIds", () => {
  it("maps Meta's legacy names: campaign_group = campaign, campaign = ad set, adgroup = ad", () => {
    expect(metaAdIds(PAYLOAD)).toEqual({
      campaign_id: "120230000000000001",
      adset_id: "120230000000000002",
      ad_id: "120230000000000003",
      account_id: "1234567890",
    });
  });

  it("falls back to ad_id for the ad and nulls anything missing or malformed", () => {
    expect(metaAdIds({ campaign_group_id: "1", ad_id: "9" })).toEqual({
      campaign_id: "1",
      adset_id: null,
      ad_id: "9",
      account_id: null,
    });
    expect(metaAdIds({ campaign_group_id: "{campaign-group-id}", campaign_id: {}, adgroup_id: "" })).toEqual({
      campaign_id: null,
      adset_id: null,
      ad_id: null,
      account_id: null,
    });
  });
});

describe("payload schemas", () => {
  it("accept what the app sends", () => {
    expect(
      PlayReferrerBody.safeParse({
        referrer: "utm_source=google-play&utm_medium=organic",
        click_ts: 0,
        install_begin_ts: 1762300100,
        click_server_ts: 0,
        install_begin_server_ts: 1762300101,
        install_version: "1.5.6",
        google_play_instant: false,
      }).success,
    ).toBe(true);
    expect(
      MetaReferrerBody.safeParse({
        install_referrer: metaProviderReferrer(),
        actual_timestamp: 1762300000,
        is_ct: 1,
        source: "instagram",
      }).success,
    ).toBe(true);
  });

  it("reject millisecond timestamps, unknown apps and oversized strings", () => {
    expect(PlayReferrerBody.safeParse({ referrer: "x", click_ts: 1762300000000 }).success).toBe(false);
    expect(MetaReferrerBody.safeParse({ install_referrer: "x", source: "whatsapp" }).success).toBe(false);
    expect(PlayReferrerBody.safeParse({ referrer: "x".repeat(10_001) }).success).toBe(false);
  });

  it("referrerFieldsFrom reads raw and treats a malformed object as absent", () => {
    const raw = {
      platform: "android",
      install_referrer: { referrer: "utm_source=google-play&utm_medium=organic" },
      meta_install_referrer: "not an object",
    };
    expect(referrerFieldsFrom(raw)).toEqual({ install_referrer: { referrer: "utm_source=google-play&utm_medium=organic" } });
    expect(referrerFieldsFrom(null)).toEqual({});
    expect(referrerFieldsFrom({ install_referrer: null, meta_install_referrer: null })).toEqual({});
  });
});

describe("resolveReferrers", () => {
  it("an organic Play install: the string and timestamps extract, nothing is evidence", () => {
    const { columns, evidence } = resolveReferrers(
      { install_referrer: { referrer: "utm_source=google-play&utm_medium=organic", click_ts: 0, install_begin_ts: 1762300100 } },
      KEY,
    );
    expect(columns).toMatchObject({
      install_referrer: "utm_source=google-play&utm_medium=organic",
      referrer_click_at: null, // 0 = Play did not see a click
      install_begin_at: "2025-11-04T23:48:20.000Z",
      referrer_click_id: null,
      ref_source: null,
      ref_campaign_id: null,
      ref_decoded: null,
    });
    expect(hasReferrerEvidence(evidence)).toBe(false);
  });

  it("our own ad link: the Play referrer carries the click id, no key needed", () => {
    const { columns, evidence } = resolveReferrers(
      { install_referrer: { referrer: `utm_source=dreamme_link&dm_click=${CLICK_ID}`, click_ts: 1762300000 } },
      undefined,
    );
    expect(columns.referrer_click_id).toBe(CLICK_ID);
    expect(columns.referrer_click_at).toBe("2025-11-04T23:46:40.000Z");
    expect(evidence).toEqual({ play_click_id: CLICK_ID, play_meta: null, meta: null });
    expect(hasReferrerEvidence(evidence)).toBe(true);
  });

  it("a Meta ad through the Play listing: decrypts the Play referrer", () => {
    const { columns, evidence } = resolveReferrers({ install_referrer: { referrer: playMetaReferrer() } }, KEY);
    expect(columns).toMatchObject({
      ref_source: "play_referrer",
      ref_campaign_id: "120230000000000001",
      ref_adset_id: "120230000000000002",
      ref_ad_id: "120230000000000003",
      ref_account_id: "1234567890",
      ref_decoded: { play: PAYLOAD },
    });
    expect(evidence.play_meta?.campaign_id).toBe("120230000000000001");
    expect(evidence.meta).toBeNull();
  });

  it("a Meta view-through: only the Meta referrer has it", () => {
    const { columns, evidence } = resolveReferrers(
      {
        install_referrer: { referrer: "utm_source=google-play&utm_medium=organic" },
        meta_install_referrer: {
          install_referrer: metaProviderReferrer(),
          actual_timestamp: 1762300000,
          is_ct: 0,
          source: "instagram",
        },
      },
      KEY,
    );
    expect(columns).toMatchObject({
      meta_referrer_app: "instagram",
      meta_referrer_at: "2025-11-04T23:46:40.000Z",
      meta_referrer_is_ct: false,
      ref_source: "meta_referrer",
      ref_campaign_id: "120230000000000001",
      ref_decoded: { meta: PAYLOAD },
    });
    expect(evidence.meta?.ad_id).toBe("120230000000000003");
    expect(evidence.play_meta).toBeNull();
  });

  it("when both name an ad, the ref_* ids follow the Play referrer and both payloads are kept", () => {
    const other = { ...PAYLOAD, campaign_group_id: "120230000000000099" };
    const { columns, evidence } = resolveReferrers(
      {
        install_referrer: { referrer: playMetaReferrer() },
        meta_install_referrer: { install_referrer: metaProviderReferrer(encrypt(JSON.stringify(other))), is_ct: 0 },
      },
      KEY,
    );
    expect(columns.ref_source).toBe("play_referrer");
    expect(columns.ref_campaign_id).toBe("120230000000000001");
    expect(columns.ref_decoded).toEqual({ play: PAYLOAD, meta: other });
    expect(evidence.meta?.campaign_id).toBe("120230000000000099");
  });

  it("with no key or the wrong key the plain parts still extract and the ids stay null", () => {
    for (const key of [undefined, "", OTHER_KEY]) {
      const { columns, evidence } = resolveReferrers(
        {
          install_referrer: { referrer: playMetaReferrer(), click_ts: 1762300000 },
          meta_install_referrer: { install_referrer: metaProviderReferrer(), is_ct: 1, source: "facebook" },
        },
        key,
      );
      expect(columns.install_referrer).toBe(playMetaReferrer());
      expect(columns.referrer_click_at).toBe("2025-11-04T23:46:40.000Z");
      expect(columns.meta_referrer_is_ct).toBe(true);
      expect(columns.meta_referrer_app).toBe("facebook");
      expect(columns.ref_source).toBeNull();
      expect(columns.ref_campaign_id).toBeNull();
      expect(columns.ref_decoded).toBeNull();
      expect(hasReferrerEvidence(evidence)).toBe(false);
    }
  });

  it("a decrypted payload that does not name the campaign is not evidence", () => {
    const { columns, evidence } = resolveReferrers(
      { install_referrer: { referrer: playMetaReferrer(encrypt(JSON.stringify({ adgroup_id: "5" }))) } },
      KEY,
    );
    expect(columns.ref_source).toBeNull();
    expect(hasReferrerEvidence(evidence)).toBe(false);
  });

  it("an iOS ping (no referrers) resolves to all-null columns", () => {
    const { columns, evidence } = resolveReferrers({}, KEY);
    expect(Object.values(columns).every((v) => v === null)).toBe(true);
    expect(hasReferrerEvidence(evidence)).toBe(false);
  });
});
