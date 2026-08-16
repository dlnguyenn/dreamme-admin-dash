import { describe, expect, it } from "vitest";
import {
  buildTrialPingMessages,
  type TrialPingTarget,
} from "@/lib/vendors/expo-push";
import {
  pickLatestTokenPerUser,
  pingWindows,
} from "@/app/api/cron/trial-pings/route";

/**
 * The trial-ping pipeline replaces a workflow that died silently for five
 * weeks, so these tests pin the three things that must never drift:
 * the payload contract the app type-checks, the window arithmetic, and the
 * one-token-per-user rule.
 */
describe("trial-pings", () => {
  describe("pingWindows", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");

    it("qualified window is [-6h, -2h], engaged is [-28h, -24h]", () => {
      const [q, e] = pingWindows(now);
      expect(q.pingType).toBe("trial_qualified");
      expect(q.from).toBe("2026-08-15T06:00:00.000Z");
      expect(q.to).toBe("2026-08-15T10:00:00.000Z");
      expect(e.pingType).toBe("trial_engaged");
      expect(e.from).toBe("2026-08-14T08:00:00.000Z");
      expect(e.to).toBe("2026-08-14T12:00:00.000Z");
    });

    it("a trial younger than the delay is NOT yet in the window", () => {
      // Trial started 1h ago: qualified fires at +2h, so it must not be
      // pinged now. Window upper bound (to) is now-2h — 1h-ago is after it.
      const [q] = pingWindows(now);
      const oneHourAgo = "2026-08-15T11:00:00.000Z";
      expect(oneHourAgo > q.to).toBe(true);
    });

    it("windows give 4h of catch-up — consecutive 15-min runs overlap heavily", () => {
      const [q] = pingWindows(now);
      const spanMs = new Date(q.to).getTime() - new Date(q.from).getTime();
      expect(spanMs).toBe(4 * 3_600_000);
    });
  });

  describe("buildTrialPingMessages — the payload contract the app enforces", () => {
    const target: TrialPingTarget = {
      expoPushToken: "ExponentPushToken[abc123]",
      pingType: "trial_qualified",
      originalTransactionId: "2000000123456789",
      productId: "dreamme_monthly",
      priceUsd: 9.99,
    };

    it("is a SILENT push: content-available, no title/body/sound", () => {
      const [m] = buildTrialPingMessages([target]);
      expect(m._contentAvailable).toBe(true);
      expect(m.priority).toBe("high");
      // A visible notification field would turn the wake-up into a user-facing
      // push — assert the message has exactly the keys we intend.
      expect(Object.keys(m).sort()).toEqual([
        "_contentAvailable",
        "data",
        "priority",
        "to",
      ]);
    });

    it("carries exactly the data fields utils/notificationHandler.ts requires", () => {
      const [m] = buildTrialPingMessages([target]);
      expect(m.data).toEqual({
        type: "trial_qualified",
        originalTransactionId: "2000000123456789",
        productId: "dreamme_monthly",
        priceUsd: 9.99,
      });
    });

    it("coerces priceUsd to a NUMBER — the app rejects string prices", () => {
      // PostgREST serializes numeric columns as strings; the client handler
      // checks `typeof priceUsd !== "number"` and drops the event.
      const [m] = buildTrialPingMessages([
        { ...target, priceUsd: "9.99" as unknown as number },
      ]);
      expect(m.data.priceUsd).toBe(9.99);
      expect(typeof m.data.priceUsd).toBe("number");
    });
  });

  describe("pickLatestTokenPerUser", () => {
    it("keeps only the newest token per user (rows arrive updated_at desc)", () => {
      const map = pickLatestTokenPerUser([
        { user_id: "u1", expo_push_token: "tok-new", updated_at: "2026-08-15" },
        { user_id: "u1", expo_push_token: "tok-old", updated_at: "2026-08-01" },
        { user_id: "u2", expo_push_token: "tok-u2", updated_at: "2026-08-10" },
      ]);
      expect(map.get("u1")).toBe("tok-new");
      expect(map.get("u2")).toBe("tok-u2");
      expect(map.size).toBe(2);
    });

    it("skips rows with missing ids or tokens", () => {
      const map = pickLatestTokenPerUser([
        { user_id: "", expo_push_token: "x", updated_at: "2026-08-15" },
        { user_id: "u3", expo_push_token: "", updated_at: "2026-08-15" },
      ]);
      expect(map.size).toBe(0);
    });
  });
});
