import { prisma } from "@/lib/prisma";

export interface KpiDelta {
  label: string;
  positive: boolean;
}

export interface Kpi {
  id: string;
  label: string;
  value: number;
  /** null when there's nothing meaningful to compare (flat, or a snapshot metric with no honest "trend"). */
  delta: KpiDelta | null;
}

/**
 * Week-over-week % change. Returns null rather than a misleading number:
 * both weeks empty (nothing happened), or 0% change (genuinely flat).
 * previous === 0 with current > 0 can't be expressed as a %, so it shows
 * the absolute new count instead of a fabricated "+Infinity%".
 */
function weekOverWeekDelta(current: number, previous: number): KpiDelta | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return { label: `+${current}`, positive: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { label: `${pct > 0 ? "+" : ""}${pct}%`, positive: pct > 0 };
}

export async function getKpis(): Promise<Kpi[]> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const dueWindow = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const [
    totalLeads,
    leadsThisWeek,
    leadsLastWeek,
    optedIn,
    optedInThisWeek,
    optedInLastWeek,
    activeCampaigns,
    messagesSentTotal,
    messagesSentThisWeek,
    messagesSentLastWeek,
    conversationsTotal,
    conversationsThisWeek,
    conversationsLastWeek,
    followUpsDue,
    aiDecisionsTotal,
    aiDecisionsThisWeek,
    aiDecisionsLastWeek,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.lead.count({ where: { optedIn: true } }),
    prisma.lead.count({ where: { optedIn: true, createdAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { optedIn: true, createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.campaign.count({ where: { status: "ACTIVE" } }),
    prisma.message.count({ where: { direction: "OUTBOUND" } }),
    prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: weekAgo } } }),
    prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.conversation.count(),
    prisma.conversation.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.conversation.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.followUp.count({ where: { status: "PENDING", scheduledFor: { lte: dueWindow } } }),
    prisma.aiDecision.count(),
    prisma.aiDecision.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.aiDecision.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
  ]);

  return [
    { id: "total-leads", label: "Total Leads", value: totalLeads, delta: weekOverWeekDelta(leadsThisWeek, leadsLastWeek) },
    { id: "opted-in", label: "Opted In", value: optedIn, delta: weekOverWeekDelta(optedInThisWeek, optedInLastWeek) },
    { id: "active-campaigns", label: "Active Campaigns", value: activeCampaigns, delta: null },
    {
      id: "messages-sent",
      label: "Messages Sent",
      value: messagesSentTotal,
      delta: weekOverWeekDelta(messagesSentThisWeek, messagesSentLastWeek),
    },
    {
      id: "conversations",
      label: "Conversations",
      value: conversationsTotal,
      delta: weekOverWeekDelta(conversationsThisWeek, conversationsLastWeek),
    },
    { id: "followups-due", label: "Follow-ups Due", value: followUpsDue, delta: null },
    {
      id: "ai-decisions",
      label: "AI Decisions",
      value: aiDecisionsTotal,
      delta: weekOverWeekDelta(aiDecisionsThisWeek, aiDecisionsLastWeek),
    },
  ];
}
