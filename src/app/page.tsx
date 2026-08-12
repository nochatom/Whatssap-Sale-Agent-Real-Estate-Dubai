import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { colors, space, sectionStyle } from "./_lib/ui-tokens";

interface DashboardCard {
  href: string;
  title: string;
  description: string;
  stat?: number;
}

/**
 * Server component — reads counts directly via the existing Prisma client,
 * no new API routes needed for a read-only overview. This replaces the old
 * `redirect("/leads")` root page: the root is now the actual dashboard, not
 * a bounce to one section.
 */
export default async function DashboardPage() {
  const sendingEnabled = process.env.SENDING_ENABLED === "true";

  const [leadCount, campaignCount, conversationCount] = await Promise.all([
    prisma.lead.count(),
    prisma.campaign.count(),
    prisma.conversation.count(),
  ]);

  const cards: DashboardCard[] = [
    {
      href: "/leads",
      title: "Leads / Contacts / CSV Import / Campaign ID / Send",
      description:
        "Upload a CSV, preview and import leads, link them to a campaign, and send the campaign message to a selected contact.",
      stat: leadCount,
    },
    {
      href: "/campaigns",
      title: "Campaigns",
      description: "View existing campaigns — status, template approval, sender number, daily budget.",
      stat: campaignCount,
    },
    {
      href: "/conversations",
      title: "Conversations",
      description: "View leads' conversations, which campaign (if any) they're linked to, and last activity.",
      stat: conversationCount,
    },
    {
      href: "/webhook-status",
      title: "WhatsApp Webhook / Status",
      description: "Webhook endpoint path, which required environment variables are configured, and sending status.",
    },
  ];

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "0.2px", margin: `0 0 ${space.sm}px` }}>
        Wahatssap Dashboard
      </h1>

      <div
        role="status"
        style={{
          borderLeft: `4px solid ${sendingEnabled ? colors.semanticWarning : colors.semanticInfo}`,
          background: colors.canvasElevated,
          padding: `${space.xxs}px ${space.xs}px`,
          marginBottom: space.lg,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.4px",
        }}
      >
        {sendingEnabled
          ? "SENDING_ENABLED IS \"TRUE\" ON THIS SERVER — SENDS CAN ATTEMPT A REAL WHATSAPP MESSAGE."
          : "LOCAL / TEST MODE — SENDING_ENABLED IS NOT SET. NO REAL WHATSAPP MESSAGE CAN BE SENT ANYWHERE IN THIS APP."}
      </div>

      <div style={{ display: "grid", gap: space.sm, gridTemplateColumns: "1fr" }}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ ...sectionStyle, display: "flex", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{c.title}</h2>
                <p style={{ color: colors.mutedText, fontSize: 13, margin: "4px 0 0" }}>{c.description}</p>
              </div>
              {c.stat !== undefined && (
                <div style={{ fontSize: 32, fontWeight: 700, color: colors.ink, flexShrink: 0 }}>{c.stat}</div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
