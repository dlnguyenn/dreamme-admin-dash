import { beforeEach, describe, expect, it, vi } from "vitest";
import { setExcludedAudiencesOnAdSet } from "@/lib/vendors/meta-ads";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("setExcludedAudiencesOnAdSet", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips the targeting write when the audience is already excluded", async () => {
    // A targeting POST resets the ad set to IN_PROCESS, so a no-op re-save
    // from the weekly refresh cron must not happen.
    const fetchMock = vi.fn(async () =>
      json({ targeting: { geo_locations: { countries: ["US"] }, excluded_custom_audiences: [{ id: "123", name: "Subs" }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await setExcludedAudiencesOnAdSet({ adsetId: "as1", excludedAudienceIds: ["123"], accessToken: "t" });

    expect(out).toEqual({ success: true, changed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes merged targeting when the audience is missing", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === "POST"
        ? json({ success: true })
        : json({ targeting: { geo_locations: { countries: ["US"] }, excluded_custom_audiences: [{ id: "999" }] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await setExcludedAudiencesOnAdSet({ adsetId: "as1", excludedAudienceIds: ["123"], accessToken: "t" });

    expect(out).toEqual({ success: true, changed: true });
    expect(calls).toHaveLength(2);
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.targeting.geo_locations).toEqual({ countries: ["US"] });
    expect(body.targeting.excluded_custom_audiences).toEqual([{ id: "999" }, { id: "123" }]);
  });
});
