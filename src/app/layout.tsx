import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import Nav from "./_components/Nav";
import { colors } from "./_lib/ui-tokens";

// Linear's own display/text/mono families are proprietary; DESIGN.md's own
// "Note on Font Substitutes" section names Inter at weight 500/600/700 as
// the closest free substitute (Geist Sans also viable) — kept 400 too for
// body text at typography.body's weight.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });

export const metadata = { title: "Wahatssap" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body
        style={{
          margin: 0,
          fontFamily: "var(--font-sans), -apple-system, system-ui, sans-serif",
          backgroundColor: colors.canvas,
          color: colors.ink,
        }}
      >
        <Nav />
        {children}
      </body>
    </html>
  );
}
