import { useEffect, useState } from "react";

const COLLAPSE_AFTER = 140;
const EXPAND_BEFORE = 72;

// Follows the page position, not the scroll direction: true past the first mark, false again only back above the
// second. The gap between the two keeps the bar from flickering when the page rests near one of them.
export function useCollapsingTopbar(page: string) {
  const [collapsed, setCollapsed] = useState(false);
  const [lastPage, setLastPage] = useState(page);
  if (page !== lastPage) {
    setLastPage(page);
    setCollapsed(false);
  }
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (window.scrollY >= COLLAPSE_AFTER) setCollapsed(true);
      else if (window.scrollY <= EXPAND_BEFORE) setCollapsed(false);
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
