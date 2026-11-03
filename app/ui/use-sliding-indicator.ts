import { useLayoutEffect, useRef } from "react";

// Measures the container's `.active` child and hands its box to CSS as --ind-x/y/w/h, so one marker element can glide
// to it with a transform (liquid-motion.css). The first placement does not animate: data-ind-ready is set a frame later.
export function useSlidingIndicator<T extends HTMLElement>(activeKey: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const place = () => {
      const active = box.querySelector<HTMLElement>(":scope > .active");
      if (!active) {
        box.removeAttribute("data-ind-on");
        return;
      }
      box.style.setProperty("--ind-x", `${active.offsetLeft}px`);
      box.style.setProperty("--ind-y", `${active.offsetTop}px`);
      box.style.setProperty("--ind-w", `${active.offsetWidth}px`);
      box.style.setProperty("--ind-h", `${active.offsetHeight}px`);
      box.setAttribute("data-ind-on", "");
    };
    place();
    const frame = requestAnimationFrame(() => box.setAttribute("data-ind-ready", ""));
    const resized = new ResizeObserver(place);
    resized.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
    };
  }, [activeKey]);
  return ref;
}
