"use client";

import * as React from "react";

/**
 * SSR-safe mobile-breakpoint hook. Returns `false` on the server and on the
 * first client render (to avoid hydration mismatches), then the real value
 * after mount. Listens to matchMedia changes so resizing the browser
 * re-renders consumers without a reload.
 *
 * Default breakpoint is 640px (Tailwind `sm:`). The design target is iPhone
 * widths (≤430px); the slightly larger cutoff gives landscape phones and
 * narrow browser windows the mobile layout too.
 */
export function useIsMobile(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // Safari <14 only supports addListener/removeListener
    if (mql.addEventListener) {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    } else {
      mql.addListener(update);
      return () => mql.removeListener(update);
    }
  }, [maxWidth]);

  return isMobile;
}
