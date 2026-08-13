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

export async function getCampaignPerformance(limit = 5): Promise<CampaignPerformance[]> {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, name: true, status: true },
  });

  return Promise.all(
    campaigns.map(async (c) => {
      const [leads, sent, replies, followUps, contacted] = await Promise.all([
        prisma.conversation.count({ where: { campaignId: c.id } }),
        prisma.message.count({ where: { direction: "OUTBOUND", conversation: { campaignId: c.id } } }),
        prisma.message.count({ where: { direction: "INBOUND", conversation: { campaignId: c.id } } }),
        prisma.followUp.count({ where: { conversation: { campaignId: c.id } } }),
        prisma.conversation.count({
          where: { campaignId: c.id, messages: { some: { direction: "OUTBOUND" } } },
        }),
      ]);

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        leads,
        sent,
        replies,
        followUps,
        progress: leads > 0 ? Math.round((contacted / leads) * 100) : 0,
      };
    }),
  );
}
