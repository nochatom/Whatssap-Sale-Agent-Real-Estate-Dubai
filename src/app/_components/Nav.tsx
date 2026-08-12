import Link from "next/link";

import { colors, space } from "../_lib/ui-tokens";
import ThemeToggle from "./ThemeToggle";

/**
 * Leads and Send both point at the same #leads-list anchor on /leads — that
 * table IS both the lead list and where the per-row Send button lives, so
 * this is accurate, not duplicated. CSV Import points at the #csv-import
 * anchor, the other section of the same page. No new pages, no new
 * components — /leads and its underlying logic are unchanged; only two
 * `id` attributes were added to its existing sections so these anchors
 * have something to jump to.
 */
const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/leads#leads-list", label: "Leads" },
  { href: "/leads#csv-import", label: "CSV Import" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/conversations", label: "Conversations" },
  { href: "/leads#leads-list", label: "Send" },
  { href: "/webhook-status", label: "Webhook Status" },
];

/**
 * Plain server component — no client interactivity needed for a link list,
 * so no "use client" and no active-route highlighting (a small omission
 * kept in the interest of minimal changes). Rendered once, globally, from
 * the root layout.
 */
export default function Nav() {
  return (
    <nav
      style={{
        display: "flex",
        gap: space.xs,
        flexWrap: "wrap",
        padding: `${space.xxs}px ${space.md}px`,
        borderBottom: `1px solid ${colors.hairline}`,
        background: colors.canvas,
      }}
    >
      {LINKS.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          style={{
            color: colors.body,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            textDecoration: "none",
            padding: "6px 0",
          }}
        >
          {link.label}
        </Link>
      ))}
      <ThemeToggle />
    </nav>
  );
}
