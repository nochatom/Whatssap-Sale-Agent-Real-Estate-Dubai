import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import Sidebar from "./_components/Sidebar";
import { colors } from "./_lib/ui-tokens";
import "./globals.css";

// Linear's own display/text/mono families are proprietary; DESIGN.md's own
// "Note on Font Substitutes" section names Inter at weight 500/600/700 as
// the closest free substitute (Geist Sans also viable) — kept 400 too for
// body text at typography.body's weight.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });

export const metadata = { title: "Wahatssap" };

// Runs before paint so a saved "light" preference applies immediately —
// without this, the page would flash dark (the :root default) for a frame
// before ThemeToggle's client-side effect corrects it on mount.
const ANTI_FLASH_SCRIPT = `
  try {
    var t = localStorage.getItem("theme");
    if (t === "light") document.documentElement.dataset.theme = "light";
  } catch (e) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      </head>
      <body
        style={{
          margin: 0,
          display: "flex",
          minHeight: "100vh",
          fontFamily: "var(--font-sans), -apple-system, system-ui, sans-serif",
          backgroundColor: colors.canvas,
          color: colors.ink,
        }}
      >
        <Sidebar sendingEnabled={process.env.SENDING_ENABLED === "true"} />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </body>
    </html>
  );
}
