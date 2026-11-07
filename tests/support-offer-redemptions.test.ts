import { describe, expect, it } from "vitest";
import { matchOfferRedemptions } from "@/lib/support/offer-redemptions";

const code = (c: string, used_at: string | null, thread_id: string | null = null, expires_on = "2027-04-29") => ({
  code: c,
  used_at,
  thread_id,
  expires_on,
});
const ev = (app_user_id: string, event_at: string) => ({ app_user_id, event_at });

describe("matchOfferRedemptions", () => {
  it("confirms a redemption on the thread's linked account", () => {
    const out = matchOfferRedemptions(
      [code("A", "2026-11-01T10:00:00Z", "t1")],
      [ev("u1", "2026-11-02T09:00:00Z")],
      { t1: "u1" },
    );
    expect(out.A).toEqual({ status: "redeemed", at: "2026-11-02T09:00:00Z", candidates: 1 });
  });

  it("calls it likely when only one code was out (Jenn, Oct 31)", () => {
    const out = matchOfferRedemptions(
      [
        code("OLD21", "2026-10-30T19:00:00Z", "tj", "2026-09-28"), // expired batch
        code("NEW1", "2026-10-31T00:13:22Z", "tj"),
      ],
      [ev("u9", "2026-10-31T00:27:38Z"), ev("u9", "2026-10-31T00:27:53Z")],
      { tj: null },
    );
    expect(out.NEW1).toEqual({ status: "likely", at: "2026-10-31T00:27:38Z", candidates: 1 });
    expect(out.OLD21).toBeUndefined();
  });

  it("reports nothing when no redemption came after the handout (Felicia)", () => {
    const out = matchOfferRedemptions(
      [code("NEW1", "2026-10-31T00:13:22Z"), code("NEW2", "2026-11-06T18:15:40Z")],
      [ev("u9", "2026-10-31T00:27:38Z")],
      {},
    );
    expect(out.NEW1?.status).toBe("likely");
    expect(out.NEW2).toBeUndefined();
  });

  it("says possible when several codes could explain one redemption", () => {
    const out = matchOfferRedemptions(
      [code("A", "2026-11-01T10:00:00Z"), code("B", "2026-11-01T11:00:00Z")],
      [ev("u1", "2026-11-02T09:00:00Z")],
      {},
    );
    expect(out.A).toEqual({ status: "possible", at: "2026-11-02T09:00:00Z", candidates: 2 });
    expect(out.B?.status).toBe("possible");
  });

  it("skips codes whose thread is linked to a different account", () => {
    const out = matchOfferRedemptions(
      [code("A", "2026-11-01T10:00:00Z", "t1"), code("B", "2026-11-01T11:00:00Z", "t2")],
      [ev("stranger", "2026-11-02T09:00:00Z")],
      { t1: "u1", t2: null },
    );
    expect(out.A).toBeUndefined();
    expect(out.B?.status).toBe("likely");
  });

  it("ignores redemptions from before the code was handed out", () => {
    const out = matchOfferRedemptions(
      [code("A", "2026-11-05T10:00:00Z")],
      [ev("u1", "2026-09-22T21:43:19Z")],
      {},
    );
    expect(out.A).toBeUndefined();
  });

  it("allows a few minutes of slack for a code marked used after it was sent", () => {
    const out = matchOfferRedemptions(
      [code("A", "2026-11-05T10:05:00Z")],
      [ev("u1", "2026-11-05T10:00:00Z")],
      {},
    );
    expect(out.A?.status).toBe("likely");
  });

  it("does not let a confirmed redemption also count toward another code", () => {
    const out = matchOfferRedemptions(
      [code("A", "2026-11-01T10:00:00Z", "t1"), code("B", "2026-11-01T11:00:00Z")],
      [ev("u1", "2026-11-02T09:00:00Z")],
      { t1: "u1" },
    );
    expect(out.A?.status).toBe("redeemed");
    expect(out.B).toBeUndefined();
  });
});
