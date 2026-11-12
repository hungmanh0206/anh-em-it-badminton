import { useEffect } from "react";

const MODAL_OPEN = ".modal-backdrop, .champion-celebration";

const scrollsItself = (element: Element) => {
  const { overflowX, overflowY } = getComputedStyle(element);
  return (/auto|scroll/.test(overflowY) && element.scrollHeight > element.clientHeight)
    || (/auto|scroll/.test(overflowX) && element.scrollWidth > element.clientWidth);
};

// CSS locks the page behind a modal (glass.css), but a finger on iOS can still drag it. So a one-finger drag is dropped
// unless it starts on something inside the modal that has its own scroll. Pinch zoom is left alone.
export function useModalScrollLock() {
  useEffect(() => {
    const holdPage = (event: TouchEvent) => {
      if (event.touches.length > 1 || !event.cancelable || !document.querySelector(MODAL_OPEN)) return;
      for (let element = event.target as Element | null; element && element !== document.body; element = element.parentElement) {
        if (scrollsItself(element)) return;
      }
      event.preventDefault();
    };
    // A blocking touch listener makes every scroll wait for the page's script, so it is only attached while a modal is
    // actually open; the rest of the time scrolling stays free.
    let attached = false;
    const sync = () => {
      const open = Boolean(document.querySelector(MODAL_OPEN));
      if (open === attached) return;
      attached = open;
      if (open) document.addEventListener("touchmove", holdPage, { passive: false });
      else document.removeEventListener("touchmove", holdPage);
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("touchmove", holdPage);
    };
  }, []);
}
