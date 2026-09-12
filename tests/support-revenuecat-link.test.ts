import { describe, expect, it } from "vitest";
import { revenueCatCustomerUrl } from "@/lib/support/revenuecat-link";

/**
 * The sidebar link is only useful if it lands on the right customer. App
 * user ids are not always tidy uuids — anonymous ids carry "$" and ":", and
 * merged accounts can carry an email — so the path segment has to be encoded
 * or RC serves a 404 on a customer who is actually there.
 */
describe("revenueCatCustomerUrl", () => {
  it("builds the dashboard customer path", () => {
    expect(
      revenueCatCustomerUrl("projc9e74a6c", "6f1c0a2e-9d4b-4a11-8c33-51f0b7a9e102"),
    ).toBe(
      "https://app.revenuecat.com/customers/projc9e74a6c/6f1c0a2e-9d4b-4a11-8c33-51f0b7a9e102",
    );
  });

  it("encodes anonymous ids and emails", () => {
    expect(revenueCatCustomerUrl("projc9e74a6c", "$RCAnonymousID:ab12cd")).toBe(
      "https://app.revenuecat.com/customers/projc9e74a6c/%24RCAnonymousID%3Aab12cd",
    );
    expect(revenueCatCustomerUrl("projc9e74a6c", "dan+test@dreamme.app")).toBe(
      "https://app.revenuecat.com/customers/projc9e74a6c/dan%2Btest%40dreamme.app",
    );
  });

  it("returns null rather than a broken link when either half is missing", () => {
    expect(revenueCatCustomerUrl(null, "user-1")).toBeNull();
    expect(revenueCatCustomerUrl("projc9e74a6c", null)).toBeNull();
    expect(revenueCatCustomerUrl("  ", "user-1")).toBeNull();
    expect(revenueCatCustomerUrl("projc9e74a6c", "  ")).toBeNull();
    expect(revenueCatCustomerUrl(undefined, undefined)).toBeNull();
  });
});
