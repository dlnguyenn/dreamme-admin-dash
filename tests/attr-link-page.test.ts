import { describe, expect, it } from "vitest";
import { encodeStoreUrl, renderLinkPage } from "@/lib/attr-link-page";

/**
 * The /l page's contract: Meta's crawler (no JavaScript) must learn nothing
 * about the store destination from the markup, while a JS-running client
 * gets sent there. Same markup for everyone.
 */

const STORE = "https://apps.apple.com/us/app/dreamme-glp-1-tracker-pet/id6755569693";
const PLAY = "https://play.google.com/store/apps/details?id=com.dreamme.app";

describe("renderLinkPage", () => {
  const html = renderLinkPage({ storeUrl: STORE });

  it("never spells out the store destination in the raw HTML", () => {
    expect(html).not.toContain("apple.com");
    expect(html).not.toContain("6755569693");
    expect(html).not.toContain("itms");
    expect(html).not.toMatch(/http-equiv\s*=\s*"refresh"/i);
    expect(html).not.toMatch(/<a[^>]+href="https?:/i);
    expect(renderLinkPage({ storeUrl: PLAY })).not.toContain("play.google.com");
  });

  it("carries the destination only as the encoded payload the script decodes", () => {
    expect(html).toContain(`atob("${encodeStoreUrl(STORE)}")`);
    expect(Buffer.from(encodeStoreUrl(STORE), "base64").toString("utf8")).toBe(STORE);
    expect(html).toContain("location.replace(u)");
  });

  it("gives crawlers Open Graph tags and a noindex hint", () => {
    expect(html).toMatch(/<meta property="og:title" content="DreamMe/);
    expect(html).toMatch(/<meta property="og:description" content="/);
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:url" content="https://go.dreamme.life/l">');
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("escapes attribute content", () => {
    const out = renderLinkPage({ storeUrl: STORE, pageUrl: 'https://x.test/l?a="b"&c=d' });
    expect(out).toContain('content="https://x.test/l?a=&quot;b&quot;&amp;c=d"');
  });
});

describe("renderLinkPage beacon", () => {
  const id = "0f6b2c4e-9d2a-4c1b-8f3e-2a7c9d1e5b6a";

  it("embeds the click id and beacons device signals to /l/b before redirecting", () => {
    const html = renderLinkPage({ storeUrl: "https://apps.apple.com/x", clickId: id });
    expect(html).toContain(`var c = "${id}"`);
    expect(html).toContain('navigator.sendBeacon("/l/b"');
    expect(html).toContain("screen.width");
    expect(html).toContain("resolvedOptions().timeZone");
    expect(html.indexOf("sendBeacon")).toBeLessThan(html.indexOf("location.replace(u)"));
  });

  it("disables the beacon for a missing or non-UUID click id (never interpolates junk into the script)", () => {
    expect(renderLinkPage({ storeUrl: "https://apps.apple.com/x" })).toContain('var c = ""');
    const hostile = '";alert(1);"';
    expect(renderLinkPage({ storeUrl: "https://apps.apple.com/x", clickId: hostile })).toContain('var c = ""');
  });
});

describe("renderLinkPage script validity", () => {
  it("emits an inline script that parses as JavaScript, with and without a beacon id", () => {
    for (const clickId of ["0f6b2c4e-9d2a-4c1b-8f3e-2a7c9d1e5b6a", undefined]) {
      const html = renderLinkPage({ storeUrl: "https://apps.apple.com/x", clickId });
      const m = html.match(/<script>([\s\S]*?)<\/script>/);
      expect(m).not.toBeNull();
      // compile only; never executed (no window here)
      expect(() => new Function(m![1])).not.toThrow();
    }
  });
});
