import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { colors, space, sectionStyle, fieldLabel } from "./_lib/ui-tokens";
import { getRecentActivity } from "./_lib/activity";
import ActivityFeed from "./_components/ActivityFeed";
import { getCampaignPerformance } from "./_lib/campaign-performance";
import CampaignPerformanceTable from "./_components/CampaignPerformanceTable";
import { getRecentConversations } from "./_lib/recent-conversations";
import RecentConversations from "./_components/RecentConversations";
import { getUpcomingFollowUps } from "./_lib/upcoming-followups";
import UpcomingFollowUps from "./_components/UpcomingFollowUps";
import { getWeeklySalesActivity } from "./_lib/sales-activity";
import { getHourlyConversationActivity } from "./_lib/conversation-activity";
import { SalesChart, ConversationActivityChart } from "./_components/Charts";
import { getKpis } from "./_lib/kpis";
import StatCards from "./_components/StatCards";

// Queries the DB on every load (lead/campaign/conversation counts) — must
// render per-request, not be statically prerendered at build time, when no
// DATABASE_URL is available.
export const dynamic = "force-dynamic";

/**
 * Server component — reads counts directly via the existing Prisma client,
 * no new API routes needed for a read-only overview. This replaces the old
 * `redirect("/leads")` root page: the root is now the actual dashboard, not
 * a bounce to one section.
 *
 * One hero (Leads/CSV Import/Send — the actual daily workflow) plus a
 * smaller secondary row (Campaigns, Conversations) — not three
 * equal-weight cards. Same dark token system as every other page
 * (colors/space/sectionStyle from ui-tokens.ts); no new colors, gradients,
 * or shadows introduced.
 */
export default async function DashboardPage() {
  const sendingEnabled = process.env.SENDING_ENABLED === "true";

  const [
    leadCount,
    campaignCount,
    conversationCount,
    activity,
    campaignPerformance,
    recentConversations,
    upcomingFollowUps,
    salesActivity,
    conversationActivity,
    kpis,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.campaign.count(),
    prisma.conversation.count(),
    getRecentActivity(),
    getCampaignPerformance(),
    getRecentConversations(),
    getUpcomingFollowUps(),
    getWeeklySalesActivity(),
    getHourlyConversationActivity(),
    getKpis(),
  ]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `64px ${space.md}px` }}>
      <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.2px", margin: `0 0 ${space.sm}px` }}>
        Wahatssap Dashboard
      </h1>

      <div
        role="status"
        style={{
          borderLeft: `4px solid ${sendingEnabled ? colors.semanticWarning : colors.semanticInfo}`,
          background: colors.canvasElevated,
          padding: `${space.xxs}px ${space.xs}px`,
          marginBottom: 64,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.4px",
        }}
      >
        {sendingEnabled
          ? "SENDING_ENABLED IS \"TRUE\" ON THIS SERVER — SENDS CAN ATTEMPT A REAL WHATSAPP MESSAGE."
          : "LOCAL / TEST MODE — SENDING_ENABLED IS NOT SET. NO REAL WHATSAPP MESSAGE CAN BE SENT ANYWHERE IN THIS APP."}
      </div>

      <div style={{ marginBottom: 64 }}>
        <StatCards kpis={kpis} />
      </div>

      <Link href="/leads" style={{ textDecoration: "none", color: "inherit" }}>
        <div
          style={{
            background: colors.canvasElevated,
            border: `1px solid ${colors.primary}`,
            borderRadius: 12,
            padding: "40px 32px",
            marginBottom: 64,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: space.md,
          }}
        >
          <div>
            <p style={{ ...fieldLabel, color: colors.primary, margin: `0 0 8px` }}>PRIMARY WORKFLOW</p>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Leads · CSV Import · Send</h2>
            <p style={{ color: colors.mutedText, fontSize: 14, margin: "8px 0 0", maxWidth: 480 }}>
              Upload a CSV, preview and import leads, link them to a campaign, and send the campaign message to a
              selected contact.
            </p>
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, color: colors.ink, lineHeight: 1 }}>{leadCount}</div>
        </div>
      </Link>

      <div style={{ display: "grid", gap: space.sm, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <Link href="/campaigns" style={{ textDecoration: "none", color: "inherit" }}>
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Campaigns</h3>
            <p style={{ color: colors.mutedText, fontSize: 13, margin: "4px 0 12px" }}>
              Status, template approval, sender number, daily budget.
            </p>
            <div style={{ fontSize: 24, fontWeight: 700, color: colors.ink }}>{campaignCount}</div>
          </div>
        </Link>

        <Link href="/conversations" style={{ textDecoration: "none", color: "inherit" }}>
          <div style={sectionStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Conversations</h3>
            <p style={{ color: colors.mutedText, fontSize: 13, margin: "4px 0 12px" }}>
              Which campaign (if any) each lead is linked to, and last activity.
            </p>
            <div style={{ fontSize: 24, fontWeight: 700, color: colors.ink }}>{conversationCount}</div>
          </div>
        </Link>
      </div>

      <div style={{ marginTop: space.sm, display: "grid", gap: space.sm, gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <SalesChart data={salesActivity} />
        <ConversationActivityChart data={conversationActivity} />
      </div>

      <div style={{ marginTop: space.sm }}>
        <CampaignPerformanceTable campaigns={campaignPerformance} />
      </div>

      <div style={{ marginTop: space.sm }}>
        <RecentConversations conversations={recentConversations} />
      </div>

      <div style={{ marginTop: space.sm }}>
        <UpcomingFollowUps followUps={upcomingFollowUps} />
      </div>

      <div style={{ marginTop: space.sm }}>
        <ActivityFeed items={activity} />
      </div>
    </main>
  );
}
