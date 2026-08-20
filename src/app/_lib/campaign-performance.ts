import type { CampaignStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export interface CampaignPerformance {
  id: string;
  name: string;
  status: CampaignStatus;
  leads: number;
  sent: number;
  replies: number;
  followUps: number;
  /** % of the campaign's leads (conversations) with at least one outbound message. */
  progress: number;
}

/**
 * Batched instead of 5 count queries per campaign (25 queries for the
 * dashboard's default limit=5, worse as limit grows): one query for
 * conversations-per-campaign, one grouped message count keyed by
 * (conversationId, direction), and one grouped follow-up count keyed by
 * conversationId — all rolled up to per-campaign totals in memory. Message
 * and FollowUp don't carry campaignId directly (only Conversation does), so
 * they can't be grouped by campaign in a single Prisma query without raw
 * SQL; going through conversationId keeps this at a fixed ~4 queries
 * regardless of campaign or conversation count instead of scaling with either.
 */
export async function getCampaignPerformance(limit = 5): Promise<CampaignPerformance[]> {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, name: true, status: true },
  });

  if (campaigns.length === 0) {
    return [];
  }

  const campaignIds = campaigns.map((c) => c.id);

  const conversations = await prisma.conversation.findMany({
    where: { campaignId: { in: campaignIds } },
    select: { id: true, campaignId: true },
  });
  const conversationCampaignId = new Map(conversations.map((c) => [c.id, c.campaignId as string]));
  const conversationIds = conversations.map((c) => c.id);

  const [messageCounts, followUpCounts] = await Promise.all([
    conversationIds.length > 0
      ? prisma.message.groupBy({
          by: ["conversationId", "direction"],
          where: { conversationId: { in: conversationIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    conversationIds.length > 0
      ? prisma.followUp.groupBy({
          by: ["conversationId"],
          where: { conversationId: { in: conversationIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const leadsByCampaign = new Map<string, number>();
  for (const conversation of conversations) {
    const campaignId = conversation.campaignId as string;
    leadsByCampaign.set(campaignId, (leadsByCampaign.get(campaignId) ?? 0) + 1);
  }

  const sentByCampaign = new Map<string, number>();
  const repliesByCampaign = new Map<string, number>();
  const contactedConversations = new Set<string>();
  for (const row of messageCounts) {
    const campaignId = conversationCampaignId.get(row.conversationId);
    if (!campaignId) continue;
    if (row.direction === "OUTBOUND") {
      sentByCampaign.set(campaignId, (sentByCampaign.get(campaignId) ?? 0) + row._count._all);
      if (row._count._all > 0) contactedConversations.add(row.conversationId);
    } else if (row.direction === "INBOUND") {
      repliesByCampaign.set(campaignId, (repliesByCampaign.get(campaignId) ?? 0) + row._count._all);
    }
  }

  const contactedByCampaign = new Map<string, number>();
  for (const conversationId of contactedConversations) {
    const campaignId = conversationCampaignId.get(conversationId);
    if (!campaignId) continue;
    contactedByCampaign.set(campaignId, (contactedByCampaign.get(campaignId) ?? 0) + 1);
  }

  const followUpsByCampaign = new Map<string, number>();
  for (const row of followUpCounts) {
    const campaignId = conversationCampaignId.get(row.conversationId);
    if (!campaignId) continue;
    followUpsByCampaign.set(campaignId, (followUpsByCampaign.get(campaignId) ?? 0) + row._count._all);
  }

  return campaigns.map((c) => {
    const leads = leadsByCampaign.get(c.id) ?? 0;
    const contacted = contactedByCampaign.get(c.id) ?? 0;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      leads,
      sent: sentByCampaign.get(c.id) ?? 0,
      replies: repliesByCampaign.get(c.id) ?? 0,
      followUps: followUpsByCampaign.get(c.id) ?? 0,
      progress: leads > 0 ? Math.round((contacted / leads) * 100) : 0,
    };
  });
}
