import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  // Apple POSTs postbacks to the well-known path WITH a trailing slash. Next's
  // default trailing-slash normalization would 308-redirect that before our
  // rewrite runs, and we can't assume Apple's postback sender follows redirects.
  // Skipping the redirect lets the `:slash(/?)` rewrites below match the
  // trailing-slash form directly. (Only affects these collector paths in
  // practice; the app's own routes don't use trailing slashes.)
  skipTrailingSlashRedirect: true,
  // Map Apple's fixed SKAN / AdAttributionKit postback well-known paths onto the
  // collector route. Apple composes the URL as <endpoint base> + <well-known
  // path>, so we accept BOTH the bare-origin form and the /skan-prefixed form
  // (the iOS plist endpoint is dreamme-admin-dash.vercel.app/skan) — either base
  // URL then works without an app rebuild. The `:slash(/?)` param matches the
  // trailing slash Apple appends, whether or not it's present. See
  // docs/skan-diy-attribution.md.
  async rewrites() {
    // Network is encoded in the destination PATH (not a query param): Next.js
    // doesn't reliably forward a rewrite destination's query string to a route
    // handler when the source has a dynamic segment.
    const skan = "/api/skan/skadnetwork";
    const aak = "/api/skan/adattributionkit";
    return [
      { source: "/.well-known/skadnetwork/report-attribution:slash(/?)", destination: skan },
      { source: "/skan/.well-known/skadnetwork/report-attribution:slash(/?)", destination: skan },
      { source: "/.well-known/adattributionkit/report-attribution:slash(/?)", destination: aak },
      { source: "/skan/.well-known/adattributionkit/report-attribution:slash(/?)", destination: aak },
      // GET /skan -> collector health/status probe.
      { source: "/skan", destination: "/api/skan/collect" },
    ];
  },
};

export default nextConfig;
