import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  QUALIFY_DELAY_MS,
  buildEvent,
  decide,
  isDue,
  matchKeys,
  type TrialRow,
} from "@/lib/capi-trial-qualified";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const trial = (over: Partial<TrialRow> = {}): TrialRow => ({
  original_transaction_id: "2000001",
  app_user_id: "3f1c9a2e-0000-4000-8000-000000000001",
  store: "APP_STORE",
  event_at: "2026-09-30T10:00:00.000Z",
  product_id: "dreamme_monthly",
  attrs: { $email: { value: " Dan@Example.com " }, $ip: { value: "1.2.3.4" } },
  ...over,
});

describe("isDue", () => {
  const start = Date.parse("2026-09-30T10:00:00.000Z");
  it("waits the full 2h", () => {
    expect(isDue(trial(), start + QUALIFY_DELAY_MS - 1)).toBe(false);
    expect(isDue(trial(), start + QUALIFY_DELAY_MS)).toBe(true);
  });
});

describe("decide", () => {
  it("qualifies a renewing trial on the matching store", () => {
    expect(
      decide("APP_STORE", [
        { store: "app_store", status: "trialing", auto_renewal_status: "will_renew" },
      ]),
    ).toBe("qualified");
  });

  it("treats a plan change as still renewing", () => {
    expect(
      decide("PLAY_STORE", [
        { store: "play_store", status: "active", auto_renewal_status: "will_change_product" },
      ]),
    ).toBe("qualified");
  });

  it("rejects a cancelled trial", () => {
    expect(
      decide("APP_STORE", [
        { store: "app_store", status: "trialing", auto_renewal_status: "will_not_renew" },
      ]),
    ).toBe("not_renewing");
  });

  it("rejects an expired subscription even if marked renewing", () => {
    expect(
      decide("APP_STORE", [
        { store: "app_store", status: "expired", auto_renewal_status: "will_renew" },
      ]),
    ).toBe("not_renewing");
  });

  it("ignores other stores", () => {
    expect(
      decide("APP_STORE", [
        { store: "play_store", status: "trialing", auto_renewal_status: "will_renew" },
      ]),
    ).toBe("no_rc_subscription");
  });
});

describe("matchKeys", () => {
  it("prefers RevenueCat attributes and takes ua from the install", () => {
    expect(matchKeys(trial(), { ip: "9.9.9.9", ua: "DreamMe/1.0 CFNetwork" })).toEqual({
      email: "Dan@Example.com",
      ip: "1.2.3.4",
      ua: "DreamMe/1.0 CFNetwork",
    });
  });

  it("falls back to the install ip and tolerates missing data", () => {
    expect(matchKeys(trial({ attrs: null }), { ip: "9.9.9.9", ua: null })).toEqual({
      email: null,
      ip: "9.9.9.9",
      ua: null,
    });
    expect(matchKeys(trial({ attrs: null }), undefined)).toEqual({ email: null, ip: null, ua: null });
  });
});

describe("buildEvent", () => {
  it("builds a website event timed at the qualification point", () => {
    const ev = buildEvent(trial(), { email: "Dan@Example.com", ip: "1.2.3.4", ua: "UA" });
    expect(ev.event_id).toBe("trial_qualified_2000001");
    expect(ev.action_source).toBe("website");
    expect(ev.event_time).toBe(
      Math.floor((Date.parse("2026-09-30T10:00:00.000Z") + QUALIFY_DELAY_MS) / 1000),
    );
    expect(ev.user_data).toEqual({
      external_id: [sha("3f1c9a2e-0000-4000-8000-000000000001")],
      em: [sha("dan@example.com")],
      client_ip_address: "1.2.3.4",
      client_user_agent: "UA",
    });
    expect(ev.custom_data).toEqual({ platform: "ios", product_id: "dreamme_monthly" });
  });

  it("omits match keys it does not have", () => {
    const ev = buildEvent(trial({ store: "PLAY_STORE" }), { email: null, ip: null, ua: null });
    expect(Object.keys(ev.user_data)).toEqual(["external_id"]);
    expect(ev.custom_data.platform).toBe("android");
  });
});
