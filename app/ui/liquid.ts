import { flushSync } from "react-dom";

// Runs a state change as a view transition styled in liquid-motion.css. `kind` is a class kept on <html> for the
// transition's length, so a smaller change can use a lighter animation than switching section. Browsers without view
// transitions, or with reduced motion asked for, just apply the change.
export function liquidTransition(update: () => void, kind?: string) {
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  if (kind) root.classList.add(kind);
  document.startViewTransition(() => flushSync(update)).finished.finally(() => {
    if (kind) root.classList.remove(kind);
  });
}
