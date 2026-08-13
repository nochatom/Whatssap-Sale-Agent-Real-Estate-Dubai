"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { colors } from "../_lib/ui-tokens";

/**
 * The only client component in the sidebar — everything else stays a
 * plain server component. Reads the theme the anti-flash script (in
 * layout.tsx) already applied to <html data-theme> before paint, so
 * there's no flash/mismatch on mount; this only needs to reflect and
 * toggle it afterward. Icon-only by design — the icon shown is the mode
 * you'd switch TO (moon = switch to dark, sun = switch to light), not the
 * current mode, matching how the icon itself communicates the action.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        background: "transparent",
        border: `1px solid ${colors.hairlineStrong}`,
        borderRadius: 6,
        color: colors.body,
        cursor: "pointer",
      }}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
