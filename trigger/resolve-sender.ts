import { prisma } from "@/lib/prisma";

export interface ResolvedSender {
  campaignId?: string;
  senderPhoneNumberId: string;
}

/**
 * Resolves which phone number a conversation's outbound send should come
 * from: its campaign's sender (if the conversation belongs to one) or its
 * own senderPhoneNumberId for an organically-initiated conversation. Returns
 * null when neither is available — callers treat that as "cannot send."
 *
 * `prefetchedCampaign` lets a caller that already started fetching the
 * campaign concurrently with other work (see send-ai-reply.ts, which
 * overlaps this with invokeSkill's ~30s call) pass its result in instead of
 * this function fetching it again; omit it to fetch lazily.
 */
export async function resolveSender(
  conversation: { campaignId: string | null; senderPhoneNumberId: string | null },
  prefetchedCampaign?: { id: string; senderPhoneNumberId: string } | null,
): Promise<ResolvedSender | null> {
  if (conversation.campaignId) {
    const campaign =
      prefetchedCampaign ??
      (await prisma.campaign.findUniqueOrThrow({ where: { id: conversation.campaignId } }));
    return { campaignId: campaign.id, senderPhoneNumberId: campaign.senderPhoneNumberId };
  }
  if (conversation.senderPhoneNumberId) {
    return { senderPhoneNumberId: conversation.senderPhoneNumberId };
  }
  return null;
}
