"use client";

import { useState } from "react";

// Same key as the script in layout.tsx, which applies the choice before the first paint.
const THEME_KEY = "aemit-theme";
type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable in private browsing; the theme still applies to this page.
    }
  };
  const dark = theme === "dark";
  return <div className="topbar-theme">
    <button type="button" role="switch" aria-checked={dark} aria-label="Giao diện tối" title={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} onClick={() => choose(dark ? "light" : "dark")}><span className="topbar-theme-light" /><span className="topbar-theme-dark" /></button>
  </div>;
}
