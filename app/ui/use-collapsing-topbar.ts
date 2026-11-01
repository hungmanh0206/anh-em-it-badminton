import { useEffect, useState } from "react";

const COLLAPSE_AFTER = 140;
const EXPAND_NEAR_TOP = 72;
const DOWN_DISTANCE = 8;
const UP_DISTANCE = 48;

// True once the page has been scrolled down far enough; scrolling back up a little or reaching the top undoes it.
// The bounce past either end of the page is ignored, so it cannot read as a change of direction.
export function useCollapsingTopbar(page: string) {
  const [collapsed, setCollapsed] = useState(false);
  const [lastPage, setLastPage] = useState(page);
  if (page !== lastPage) {
    setLastPage(page);
    setCollapsed(false);
  }
  useEffect(() => {
    let last = 0;
    let travelled = 0;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const end = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
      const y = Math.min(Math.max(window.scrollY, 0), end);
      const delta = y - last;
      if (!delta) return;
      travelled = Math.sign(delta) === Math.sign(travelled) ? travelled + delta : delta;
      last = y;
      if (y <= EXPAND_NEAR_TOP || travelled <= -UP_DISTANCE) setCollapsed(false);
      else if (y >= COLLAPSE_AFTER && travelled >= DOWN_DISTANCE) setCollapsed(true);
    };
    const onScroll = () => { frame ||= requestAnimationFrame(measure); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return collapsed;
}
