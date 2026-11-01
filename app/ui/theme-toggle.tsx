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
  return <div className="topbar-theme" role="group" aria-label="Giao diện">
    <button type="button" aria-label="Giao diện sáng" title="Giao diện sáng" aria-pressed={theme === "light"} onClick={() => choose("light")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" /></svg></button>
    <button type="button" aria-label="Giao diện tối" title="Giao diện tối" aria-pressed={theme === "dark"} onClick={() => choose("dark")}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" /></svg></button>
  </div>;
}
