"use client";

import { useEffect, useState } from "react";

import { colors } from "../_lib/ui-tokens";

/**
 * The only client component in the sidebar — everything else stays a
 * plain server component. Reads the theme the anti-flash script (in
 * layout.tsx) already applied to <html data-theme> before paint, so
 * there's no flash/mismatch on mount; this only needs to reflect and
 * toggle it afterward. Positioning (where it sits) is the caller's job,
 * not this component's — it renders as a plain full-width button.
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
      style={{
        width: "100%",
        background: "transparent",
        border: `1px solid ${colors.hairlineStrong}`,
        borderRadius: 6,
        color: colors.body,
        fontSize: 12,
        fontWeight: 500,
        padding: "8px 10px",
        cursor: "pointer",
      }}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
