import { describe, expect, it } from "vitest";
import { INVITE_CODE_RE, inviteLinkUrl, normalizeInviteCode } from "@/lib/attr-invite";
import { INVITE_PREVIEW, renderLinkPage } from "@/lib/attr-link-page";

describe("invite codes", () => {
  it("accepts 7 characters from the no-look-alike alphabet, any case", () => {
    expect(normalizeInviteCode("k7m2qpz")).toBe("k7m2qpz");
    expect(normalizeInviteCode(" K7M2QPZ ")).toBe("k7m2qpz");
  });

  it("refuses look-alikes, wrong lengths and junk", () => {
    for (const c of ["k7m2qp", "k7m2qpzz", "k7m2qp0", "k7m2qpo", "k7m2qp1", "k7m2qpl", "k7m2qpi", "k7m-qpz", "", null, undefined]) {
      expect(normalizeInviteCode(c as string | null | undefined), String(c)).toBeNull();
    }
    expect(INVITE_CODE_RE.test("abcdefg")).toBe(true);
  });

  it("builds the public link", () => {
    expect(inviteLinkUrl("k7m2qpz")).toBe("https://go.dreamme.life/i/k7m2qpz");
  });
});

describe("invite link page", () => {
  const html = renderLinkPage({
    storeUrl: "https://apps.apple.com/app/id0",
    pageUrl: inviteLinkUrl("k7m2qpz"),
    preview: INVITE_PREVIEW,
  });

  it("carries the invite preview with a picture", () => {
    expect(html).toContain('<meta property="og:title" content="Join me on DreamMe">');
    expect(html).toContain('<meta property="og:image" content="https://go.dreamme.life/invite-preview.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:url" content="https://go.dreamme.life/i/k7m2qpz">');
  });

  it("leaves the ad link's page without a picture", () => {
    const ad = renderLinkPage({ storeUrl: "https://apps.apple.com/app/id0" });
    expect(ad).not.toContain("og:image");
    expect(ad).toContain('<meta name="twitter:card" content="summary">');
  });
});
