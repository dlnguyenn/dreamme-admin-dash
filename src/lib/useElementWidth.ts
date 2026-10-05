"use client";

import * as React from "react";

/**
 * Width of an element, tracked with a ResizeObserver. Use it when a layout
 * should respond to the space it actually has (the sidebar eats ~240px, so
 * the viewport breakpoint alone isn't enough). Width is 0 until measured.
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
