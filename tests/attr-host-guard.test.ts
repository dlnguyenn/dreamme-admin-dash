import { describe, expect, it } from "vitest";
// Next's own matcher, with the options it uses for redirects (filesystem.js).
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { modifyRouteRegex } from "next/dist/lib/redirect-status";
import nextConfig, { ATTR_HOST, ATTR_HOST_GUARD_SOURCE } from "../next.config";

const match = getPathMatch(ATTR_HOST_GUARD_SOURCE, {
  strict: true,
  removeUnnamedParams: true,
  regexModifier: (r: string) => modifyRouteRegex(r, ["/_next"]),
});
const redirected = (path: string) => match(path) !== false;

describe("go.dreamme.life host guard", () => {
  it("lets the public attribution paths through", () => {
    for (const p of ["/l", "/l/b", "/i", "/i/k7m2qpz", "/invite-preview.png", "/api/attr/install", "/api/cron/attr-match", "/api/cron/attr-capi"]) {
      expect(redirected(p), p).toBe(false);
    }
  });

  it("sends everything else, the dashboard included, to dreamme.life", () => {
    for (const p of ["/", "/creatives", "/api/roadmap", "/api/experiments", "/api/auth/google/start", "/api/cron/attr-capi-x", "/l/bb", "/i/a/b", "/api/attr/overview", "/skan"]) {
      expect(redirected(p), p).toBe(true);
    }
  });

  it("only applies on the go.dreamme.life host", async () => {
    const rules = await nextConfig.redirects!();
    const guard = rules.find((r) => r.source === ATTR_HOST_GUARD_SOURCE);
    expect(guard?.has).toEqual([{ type: "host", value: ATTR_HOST }]);
    expect(guard?.destination).toBe("https://dreamme.life");
    expect(guard?.permanent).toBe(false);
  });
});
