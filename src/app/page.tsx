import { space } from "./_lib/ui-tokens";
import { getRecentActivity } from "./_lib/activity";
import ActivityFeed from "./_components/ActivityFeed";
import { getCampaignPerformance } from "./_lib/campaign-performance";
import CampaignPerformanceTable from "./_components/CampaignPerformanceTable";
import { getRecentConversations } from "./_lib/recent-conversations";
import RecentConversations from "./_components/RecentConversations";
import { getUpcomingFollowUps } from "./_lib/upcoming-followups";
import UpcomingFollowUps from "./_components/UpcomingFollowUps";
import { getKpis } from "./_lib/kpis";
import StatCards from "./_components/StatCards";
import { getWeeklySalesActivity } from "./_lib/sales-activity";
import { getHourlyConversationActivity } from "./_lib/conversation-activity";
import { SalesChart, ConversationActivityChart } from "./_components/Charts";

// Queries the DB on every load — must render per-request, not be statically
// prerendered at build time, when no DATABASE_URL is available.
export const dynamic = "force-dynamic";

/**
 * Server component — reads real data directly via the existing Prisma
 * client, no new API routes, no new components. Two zones instead of
 * seven equal-weight stacked cards: "Pulse" (KPIs + both charts, grouped
 * together since they're both at-a-glance signal) then "Operations"
 * (the four detail lists/tables). Section spacing widened from 24px to
 * 48px so each zone actually reads as separate, not a single undifferentiated
 * scroll. Same dark token system as every other page (colors/space/
 * sectionStyle from ui-tokens.ts); no new colors, gradients, or shadows.
 */
export default async function DashboardPage() {
  const [activity, campaignPerformance, recentConversations, upcomingFollowUps, kpis, salesActivity, conversationActivity] =
    await Promise.all([
      getRecentActivity(),
      getCampaignPerformance(),
      getRecentConversations(),
      getUpcomingFollowUps(),
      getKpis(),
      getWeeklySalesActivity(),
      getHourlyConversationActivity(),
    ]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `64px ${space.md}px` }}>
      <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.2px", margin: `0 0 ${space.sm}px` }}>
        Wahatssap Dashboard
      </h1>

      {/* Pulse: KPIs + both charts — the at-a-glance zone, grouped together */}
      <div style={{ marginTop: space.md }}>
        <StatCards kpis={kpis} />
      </div>

      <div style={{ marginTop: space.sm, display: "grid", gap: space.sm, gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
        <SalesChart data={salesActivity} />
        <ConversationActivityChart data={conversationActivity} />
      </div>

      {/* Operations: the detail lists/tables, visually separated from the pulse zone above */}
      <div style={{ marginTop: 48 }}>
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
