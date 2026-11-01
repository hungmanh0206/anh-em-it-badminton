import { useEffect, useState } from "react";

const COLLAPSE_AFTER = 140;
const EXPAND_BEFORE = 72;
// The page can still scroll behind a modal; the bar stays as it is until the modal closes. The profile card hangs off
// the bar, so it does not count.
const MODAL_OPEN = ".modal-backdrop:not(.profile-backdrop), .champion-celebration";

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
      if (document.querySelector(MODAL_OPEN)) return;
      if (window.scrollY >= COLLAPSE_AFTER) setCollapsed(true);
      else if (window.scrollY <= EXPAND_BEFORE) setCollapsed(false);
    };
    const check = () => { frame ||= requestAnimationFrame(measure); };
    window.addEventListener("scroll", check, { passive: true });
    // Modals are portalled straight into <body>, so this also catches one closing: the bar catches up with the page then.
    const portals = new MutationObserver(check);
    portals.observe(document.body, { childList: true });
    return () => {
      window.removeEventListener("scroll", check);
      portals.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return collapsed;
}
