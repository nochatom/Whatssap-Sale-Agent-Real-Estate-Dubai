"use client";

import { useEffect, useState } from "react";

import { colors } from "../_lib/ui-tokens";

/**
 * Only client component in the nav — everything else stays a plain server
 * component. Reads the theme the anti-flash script (in layout.tsx) already
 * applied to <html data-theme> before paint, so there's no flash/mismatch
 * on mount; this only needs to reflect and toggle it afterward.
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
        background: "transparent",
        border: `1px solid ${colors.hairlineStrong}`,
        borderRadius: 6,
        color: colors.body,
        fontSize: 12,
        fontWeight: 500,
        padding: "5px 10px",
        cursor: "pointer",
        marginLeft: "auto",
      }}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
