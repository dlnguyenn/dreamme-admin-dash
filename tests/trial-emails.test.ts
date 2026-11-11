import { describe, expect, it } from "vitest";
import {
  armOf,
  bucketOf,
  decide,
  diffWithCi,
  firstName,
  fishName,
  makeToken,
  perArmNeeded,
  readToken,
  sendWindows,
  trialStatus,
  type RcEventLite,
  type UserFacts,
} from "@/lib/trial-emails/core";
import { allVariants, renderEmail } from "@/lib/trial-emails/content";

/**
 * Trial emails reach real trialists, so these pin what must never drift:
 * the split, the windows, the skip rules, the signed links, and the copy
 * rules Dan set (no em dashes, co-founder, unsubscribe in every email).
 */
const START = "2026-11-16T15:00:00.000Z";
const ev = (type: string, at: string, extra: Partial<RcEventLite> = {}): RcEventLite => ({
  type,
  period_type: "TRIAL",
  event_at: at,
  price_usd: null,
  cancel_reason: null,
  ...extra,
});
const user = (o: Partial<UserFacts> = {}): UserFacts => ({
  email: "a@privaterelay.appleid.com",
  displayName: "Jamie Smith",
  companionName: null,
  journeyStage: "already_on",
  language: null,
  suppressed: false,
  shotLogged: false,
  sideEffectLogged: false,
  weightLogged: false,
  ...o,
});

describe("trial-emails: split", () => {
  it("is stable per user and roughly 50/50", () => {
    expect(bucketOf("2f1c6f5e-0000-4000-8000-000000000001")).toBe(bucketOf("2f1c6f5e-0000-4000-8000-000000000001"));
    let email = 0;
    for (let i = 0; i < 4000; i++) if (armOf(bucketOf(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)) === "email") email++;
    expect(email / 4000).toBeGreaterThan(0.47);
    expect(email / 4000).toBeLessThan(0.53);
  });
  it("buckets 0-49 are email, 50-99 holdout", () => {
    expect(armOf(0)).toBe("email");
    expect(armOf(49)).toBe("email");
    expect(armOf(50)).toBe("holdout");
    expect(armOf(99)).toBe("holdout");
  });
});

describe("trial-emails: windows", () => {
  it("day 0 is the last 6 hours, day 1 is hours 24-30", () => {
    const [d0, d1] = sendWindows(new Date("2026-11-17T18:00:00.000Z"));
    expect(d0).toMatchObject({ kind: "day0", from: "2026-11-17T12:00:00.000Z", to: "2026-11-17T18:00:00.000Z" });
    expect(d1).toMatchObject({ kind: "day1", from: "2026-11-16T12:00:00.000Z", to: "2026-11-16T18:00:00.000Z" });
  });
});

describe("trial-emails: status", () => {
  it("auto-renew off, then back on", () => {
    expect(trialStatus([ev("CANCELLATION", "2026-11-16T15:01:00Z")], START)).toBe("auto_renew_off");
    expect(trialStatus([ev("CANCELLATION", "2026-11-16T15:01:00Z"), ev("UNCANCELLATION", "2026-11-16T16:00:00Z")], START)).toBe("active");
  });
  it("paid, refunded, expired", () => {
    expect(trialStatus([ev("RENEWAL", "2026-11-23T15:00:00Z", { period_type: "NORMAL", price_usd: 14.99 })], START)).toBe("converted");
    expect(trialStatus([ev("CANCELLATION", "2026-11-24T15:00:00Z", { cancel_reason: "CUSTOMER_SUPPORT" })], START)).toBe("refunded");
    expect(trialStatus([ev("EXPIRATION", "2026-11-23T15:00:00Z")], START)).toBe("expired");
  });
});

describe("trial-emails: decide", () => {
  it("skips converted, expired, refunded, no email, unsubscribed, non-English", () => {
    expect(decide("day0", "converted", user())).toEqual({ send: false, reason: "converted" });
    expect(decide("day0", "expired", user())).toEqual({ send: false, reason: "expired" });
    expect(decide("day0", "refunded", user())).toEqual({ send: false, reason: "refunded" });
    expect(decide("day0", "active", user({ email: null }))).toEqual({ send: false, reason: "no_email" });
    expect(decide("day0", "active", user({ suppressed: true }))).toEqual({ send: false, reason: "unsubscribed" });
    expect(decide("day0", "active", user({ language: "de" }))).toEqual({ send: false, reason: "not_english" });
    expect(decide("day0", "active", user({ language: "en" })).send).toBe(true);
  });
  it("emails auto-renew-off trialists in the status-aware version", () => {
    expect(decide("day0", "auto_renew_off", user())).toMatchObject({ send: true, cancelled: true, cta: "shot" });
  });
  it("day 0 asks for the shot (shot day when about to start), then the next action not done", () => {
    expect(decide("day0", "active", user())).toMatchObject({ cta: "shot" });
    expect(decide("day0", "active", user({ journeyStage: "about_to_start" }))).toMatchObject({ cta: "shot_day", aboutToStart: true });
    expect(decide("day0", "active", user({ shotLogged: true }))).toMatchObject({ cta: "side_effect" });
    expect(decide("day0", "active", user({ shotLogged: true, sideEffectLogged: true }))).toMatchObject({ cta: "weight" });
  });
  it("day 1 asks how they feel first; all three done = activated, no email", () => {
    expect(decide("day1", "active", user({ shotLogged: true }))).toMatchObject({ cta: "side_effect" });
    expect(decide("day1", "active", user({ sideEffectLogged: true }))).toMatchObject({ cta: "shot" });
    expect(decide("day1", "active", user({ shotLogged: true, sideEffectLogged: true, weightLogged: true }))).toEqual({
      send: false,
      reason: "activated",
    });
  });
});

describe("trial-emails: names", () => {
  it("first name or 'there'", () => {
    expect(firstName("jamie smith")).toBe("Jamie");
    expect(firstName("")).toBe("there");
    expect(firstName("user12345")).toBe("there");
    expect(firstName("a@b.com")).toBe("there");
  });
  it("fish name or Sushi", () => {
    expect(fishName("Zeppy")).toBe("Zeppy");
    expect(fishName(null)).toBe("Sushi");
    expect(fishName("<script>")).toBe("Sushi");
    expect(fishName("a very long name for a fish")).toBe("Sushi");
  });
});

describe("trial-emails: tokens", () => {
  it("round-trips and rejects tampering", () => {
    const t = makeToken("2000001234567890", "day0", "k");
    expect(readToken(t, "k")).toEqual({ originalTransactionId: "2000001234567890", purpose: "day0" });
    expect(readToken(t, "other")).toBeNull();
    const forged = `${Buffer.from("2000001234567890|unsub").toString("base64url")}.${t.split(".")[1]}`;
    expect(readToken(forged, "k")).toBeNull();
    expect(readToken("junk", "k")).toBeNull();
  });
});

describe("trial-emails: stats", () => {
  it("sample size matches the vault estimate (~1,490 per arm for 5 points at 36%)", () => {
    const n = perArmNeeded(0.361, 0.05);
    expect(n).toBeGreaterThan(1400);
    expect(n).toBeLessThan(1600);
  });
  it("no interval before 30 per arm", () => {
    expect(diffWithCi({ n: 10, x: 4 }, { n: 10, x: 3 })).toBeNull();
    const r = diffWithCi({ n: 1000, x: 400 }, { n: 1000, x: 360 })!;
    expect(r.diff).toBeCloseTo(0.04, 5);
    expect(r.low).toBeLessThan(r.diff);
  });
});

describe("trial-emails: copy rules", () => {
  const all = allVariants().map((v) =>
    renderEmail({
      ...v,
      firstName: "Jamie",
      fish: "Sushi",
      trialEnd: "Monday, Nov 23",
      platform: "ios",
      ctaUrl: "https://x/go",
      unsubscribeUrl: "https://x/unsub",
      assets: {
        heroDay0: "https://x/h0.gif",
        heroDay1: "https://x/h1.gif",
        icon: "https://x/i.png",
        font: "https://x/f.ttf",
        moods: { great: "https://x/g.png", okay: "https://x/o.png", rough: "https://x/r.png", tired: "https://x/t.png" },
      },
    }),
  );
  it("no em dashes anywhere, signed as co-founder, unsubscribe and CTA twice in every email", () => {
    for (const e of all) {
      for (const part of [e.subject, e.preview, e.text, e.html]) expect(part).not.toMatch(/—/);
      expect(e.text).toContain("Co-founder, DreamMe");
      expect(e.html).toContain("https://x/unsub");
      // button + P.S. link, plus four mood tiles on the day-1 "how are you feeling" version
      expect([2, 6]).toContain(e.html.split("https://x/go").length - 1);
      // A double quote inside style="..." ends the attribute and drops every style after it.
      for (const m of e.html.matchAll(/style="([^"]*)"/g)) expect(m[1]).not.toMatch(/font:[^;]*$/);
      expect(e.html).not.toContain('"Segoe');
    }
  });
  it("the auto-renew-off version says they won't be charged; the active one gives the end date", () => {
    const v = allVariants();
    const off = all[v.findIndex((x) => x.kind === "day0" && x.cancelled)];
    const on = all[v.findIndex((x) => x.kind === "day0" && !x.cancelled)];
    expect(off.text).toContain("You won't be charged");
    expect(off.text).not.toContain("Free until");
    expect(on.text).not.toMatch(/make it this:/);
    expect(on.text).toContain("Free until Monday, Nov 23");
    expect(on.text).toContain("Nothing is charged before then");
  });
});

describe("trial-emails: themes", () => {
  it("blue and lux both render, each with its own banner colour and art", () => {
    const base = {
      kind: "day1" as const,
      cta: "side_effect" as const,
      cancelled: false,
      aboutToStart: false,
      firstName: "Jamie",
      fish: "Sushi",
      trialEnd: "Monday, Nov 23",
      platform: "ios" as const,
      ctaUrl: "https://x/go",
      unsubscribeUrl: "https://x/unsub",
      assets: {
        heroDay0: "h0",
        heroDay1: "h1",
        icon: "i",
        font: "f",
        moods: { great: "g", okay: "o", rough: "r", tired: "t" },
      },
    };
    const blue = renderEmail({ ...base, theme: "blue" }).html;
    const lux = renderEmail({ ...base, theme: "lux" }).html;
    expect(blue).toContain("#2D5F8A");
    expect(lux).toContain("#E6DCCF");
    expect(lux).not.toContain("#2D5F8A");
    // no cards nested inside the sheet: panels are gone
    for (const h of [blue, lux]) expect(h).not.toMatch(/border-radius:16px/);
  });
});
