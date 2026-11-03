"use client";

import { useState } from "react";
import { liquidTransition } from "@/app/ui/liquid";

// Same key as the script in layout.tsx, which applies the choice before the first paint.
const THEME_KEY = "aemit-theme";
type Theme = "light" | "dark";

export function ThemeToggle() {
  // Only after a tap do the thumb and icons animate; the first render just shows the current theme.
  const [moved, setMoved] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable in private browsing; the theme still applies to this page.
    }
  };
  // The new theme spreads out from the switch like spilt colour (liquid-motion.css).
  const choose = (next: Theme, from: HTMLElement) => {
    setMoved(true);
    const root = document.documentElement;
    const { left, top, width, height } = from.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    root.style.setProperty("--theme-x", `${x}px`);
    root.style.setProperty("--theme-y", `${y}px`);
    root.style.setProperty("--theme-r", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
    liquidTransition(() => apply(next), "theme-switching");
  };
  const dark = theme === "dark";
  return <div className="topbar-theme">
    <button type="button" className={moved ? "has-moved" : undefined} role="switch" aria-checked={dark} aria-label="Giao diện tối" title={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} onClick={(event) => choose(dark ? "light" : "dark", event.currentTarget)}><i className="topbar-theme-thumb" /><span className="topbar-theme-sun" /><span className="topbar-theme-moon" /></button>
  </div>;
}
