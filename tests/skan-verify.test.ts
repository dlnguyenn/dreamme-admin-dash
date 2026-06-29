import { describe, expect, it } from "vitest";
import { signableString, verifySkanSignature } from "@/lib/skan/verify";
import {
  decodeEvent,
  extractFields,
  mapCampaign,
  type CampaignMapRow,
  type CvSchemaRow,
} from "@/lib/skan/decode";

// Real Apple worked-example postbacks (from Apple's docs / the whisk reference
// validator). Their signatures verify against Apple's production P-256 key, so
// they double as regression vectors: if the field order, separator, or crypto
// usage drifts, these flip to invalid.
const APPLE_4_0_FINE = {
  version: "4.0",
  "ad-network-id": "com.example",
  "source-identifier": "5239",
  "app-id": 525463029,
  "transaction-id": "6aafb7a5-0170-41b5-bbe4-fe71dedf1e30",
  redownload: false,
  "source-domain": "example.com",
  "fidelity-type": 1,
  "did-win": true,
  "conversion-value": 63,
  "postback-sequence-index": 0,
  "attribution-signature":
    "MEUCIGRmSMrqedNu6uaHyhVcifs118R5z/AB6cvRaKrRRHWRAiEAv96ne3dKQ5kJpbsfk4eYiePmrZUU6sQmo+7zfP/1Bxo=",
};

const APPLE_4_0_COARSE = {
  version: "4.0",
  "ad-network-id": "com.example",
  "source-identifier": "39",
  "app-id": 525463029,
  "transaction-id": "6aafb7a5-0170-41b5-bbe4-fe71dedf1e31",
  redownload: false,
  "source-domain": "example.com",
  "fidelity-type": 1,
  "did-win": true,
  "coarse-conversion-value": "high",
  "postback-sequence-index": 0,
  "attribution-signature":
    "MEUCIQD4rX6eh38qEhuUKHdap345UbmlzA7KEZ1bhWZuYM8MJwIgMnyiiZe6heabDkGwOaKBYrUXQhKtF3P/ERHqkR/XpuA=",
};

const APPLE_2_2 = {
  version: "2.2",
  "ad-network-id": "com.example",
  "campaign-id": 42,
  "transaction-id": "6aafb7a5-0170-41b5-bbe4-fe71dedf1e28",
  "app-id": 525463029,
  "attribution-signature":
    "MEYCIQDTuQ1Z4Tpy9D3aEKbxLl5J5iKiTumcqZikuY/AOD2U7QIhAJAaiAv89AoquHXJffcieEQXdWHpcV8ZgbKN0EwV9/sY",
  redownload: true,
  "source-app-id": 1234567891,
  "fidelity-type": 1,
  "conversion-value": 20,
};

describe("verifySkanSignature", () => {
  it("validates a real 4.0 fine-value postback", () => {
    expect(verifySkanSignature(APPLE_4_0_FINE)).toBe("valid");
  });
  it("validates a real 4.0 coarse postback", () => {
    expect(verifySkanSignature(APPLE_4_0_COARSE)).toBe("valid");
  });
  it("validates a real 2.2 postback", () => {
    expect(verifySkanSignature(APPLE_2_2)).toBe("valid");
  });
  it("rejects a tampered postback (source-identifier flipped)", () => {
    expect(
      verifySkanSignature({ ...APPLE_4_0_FINE, "source-identifier": "9999" }),
    ).toBe("invalid");
  });
  it("rejects a missing signature", () => {
    const { "attribution-signature": _omit, ...rest } = APPLE_4_0_FINE;
    expect(verifySkanSignature(rest)).toBe("invalid");
  });
  it("flags unsupported versions (1.0 / 2.0)", () => {
    expect(verifySkanSignature({ ...APPLE_2_2, version: "2.0" })).toBe(
      "unsupported_version",
    );
  });
  it("builds the exact signed string (conversion-value excluded, ends at sequence-index)", () => {
    const SEP = "⁣";
    const expected = [
      "4.0",
      "com.example",
      "5239",
      "525463029",
      "6aafb7a5-0170-41b5-bbe4-fe71dedf1e30",
      "false",
      "example.com",
      "1",
      "true",
      "0",
    ].join(SEP);
    expect(signableString(APPLE_4_0_FINE, "4.0")).toBe(expected);
  });
});

// Mirrors the ladder seeded in migration 0031 (Meta Events Manager config).
const SCHEMA: CvSchemaRow[] = [
  { postback_sequence_index: 0, value_kind: "fine", fine_value: 63, coarse_value: null, event: "purchase" },
  { postback_sequence_index: 0, value_kind: "fine", fine_value: 62, coarse_value: null, event: "subscribed" },
  { postback_sequence_index: 0, value_kind: "fine", fine_value: 61, coarse_value: null, event: "trial_started" },
  { postback_sequence_index: 0, value_kind: "fine", fine_value: 60, coarse_value: null, event: "complete_registration" },
  { postback_sequence_index: 1, value_kind: "coarse", fine_value: null, coarse_value: "high", event: "subscribed" },
  { postback_sequence_index: 1, value_kind: "coarse", fine_value: null, coarse_value: "medium", event: "trial_started" },
  { postback_sequence_index: 1, value_kind: "coarse", fine_value: null, coarse_value: "low", event: "complete_registration" },
];

describe("decodeEvent", () => {
  it("maps P1 fine 61 -> trial_started", () => {
    const f = extractFields({ ...APPLE_4_0_FINE, "conversion-value": 61 }, "skadnetwork");
    expect(decodeEvent(f, SCHEMA)).toBe("trial_started");
  });
  it("maps P1 fine 62 -> subscribed", () => {
    const f = extractFields({ ...APPLE_4_0_FINE, "conversion-value": 62 }, "skadnetwork");
    expect(decodeEvent(f, SCHEMA)).toBe("subscribed");
  });
  it("maps P2 coarse high -> subscribed (day-7 conversion)", () => {
    const f = extractFields(
      { ...APPLE_4_0_COARSE, "postback-sequence-index": 1, "coarse-conversion-value": "high" },
      "skadnetwork",
    );
    expect(decodeEvent(f, SCHEMA)).toBe("subscribed");
  });
  it("returns null for an unmapped fine value (0-59)", () => {
    const f = extractFields({ ...APPLE_4_0_FINE, "conversion-value": 5 }, "skadnetwork");
    expect(decodeEvent(f, SCHEMA)).toBeNull();
  });
});

describe("mapCampaign", () => {
  const MAP: CampaignMapRow[] = [
    {
      network: "skadnetwork",
      source_identifier: "5239",
      meta_campaign_id: "120246868370250622",
      meta_campaign_name: "DreamMe Batch2 UGC Test (SKAN)",
    },
  ];
  it("resolves a known source-identifier to a campaign", () => {
    const f = extractFields(APPLE_4_0_FINE, "skadnetwork");
    expect(mapCampaign(f, MAP).id).toBe("120246868370250622");
  });
  it("returns null + note for an unmapped source-identifier", () => {
    const f = extractFields({ ...APPLE_4_0_FINE, "source-identifier": "1" }, "skadnetwork");
    const res = mapCampaign(f, MAP);
    expect(res.id).toBeNull();
    expect(res.note).toContain("unmapped");
  });
});
