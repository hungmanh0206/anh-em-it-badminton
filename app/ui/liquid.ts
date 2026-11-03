import { flushSync } from "react-dom";

let latest: ViewTransition | null = null;

// Runs a state change as a view transition styled in liquid-motion.css. `.vt-active` and `kind` stay on <html> for the
// transition's length; `kind` lets a smaller change use a lighter animation than switching section. Browsers without view
// transitions, or with reduced motion asked for, just apply the change.
export function liquidTransition(update: () => void, kind?: string) {
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  root.classList.remove("vt-tab", "vt-filter", "theme-switching");
  root.classList.add("vt-active", ...(kind ? [kind] : []));
  const transition = document.startViewTransition(() => flushSync(update));
  latest = transition;
  // A quick second change skips the first, whose clean-up must not strip the classes the second one needs.
  transition.finished.finally(() => {
    if (latest !== transition) return;
    latest = null;
    root.classList.remove("vt-active", "vt-tab", "vt-filter", "theme-switching");
  });
}
