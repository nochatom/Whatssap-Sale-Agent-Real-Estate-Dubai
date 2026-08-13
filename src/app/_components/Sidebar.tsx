"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, FileUp, Megaphone, MessagesSquare, Send, MessageCircle, Bell, type LucideIcon } from "lucide-react";

import { colors, space } from "../_lib/ui-tokens";
import ThemeToggle from "./ThemeToggle";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Replaces the former top Nav.tsx. Leads/CSV Import/Send are now three
 * genuinely separate pages (the Import → Select → Send workflow), each
 * with its own route — no more anchor-fragment sharing on one page.
 * Webhook Status intentionally excluded, per prior explicit instruction.
 */
const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Leads", href: "/leads", icon: Users },
  { label: "CSV Import", href: "/leads/import", icon: FileUp },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone },
  { label: "Conversations", href: "/conversations", icon: MessagesSquare },
  { label: "Send", href: "/leads/send", icon: Send },
];

/**
 * Active state comes from the real URL (usePathname), not local click
 * state — correct on direct load, refresh, and back/forward, not just
 * after a click in this session.
 */
export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${colors.hairline}`,
        background: colors.canvas,
        padding: `${space.sm}px ${space.xs}px`,
        minHeight: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `0 ${space.xxs}px` }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: 10,
            background: colors.primary,
            color: colors.onPrimary,
            flexShrink: 0,
          }}
        >
          <MessageCircle size={18} />
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.ink }}>Wahatssap</p>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: "1.2px", textTransform: "uppercase", color: colors.mutedText }}>
            WhatsApp AI
          </p>
        </div>
      </div>

      <nav style={{ marginTop: space.md, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                color: isActive ? colors.ink : colors.mutedText,
                background: isActive ? colors.canvasElevated : "transparent",
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 2,
                    height: 20,
                    borderRadius: 9999,
                    background: colors.primary,
                  }}
                />
              )}
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ borderTop: `1px solid ${colors.hairline}`, paddingTop: space.xs, marginTop: space.xs, display: "flex", gap: 8 }}>
        {/* Plain icon, no unread badge — no read/unread tracking exists in
            this schema, so a fake dot here would be the same dishonest
            pattern already removed from the old Topbar reference. Links to
            the Dashboard, where real activity/follow-ups actually live. */}
        <Link
          href="/"
          aria-label="Notifications — go to Dashboard activity"
          title="Notifications — go to Dashboard activity"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            border: `1px solid ${colors.hairlineStrong}`,
            borderRadius: 6,
            color: colors.body,
          }}
        >
          <Bell size={16} />
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}
