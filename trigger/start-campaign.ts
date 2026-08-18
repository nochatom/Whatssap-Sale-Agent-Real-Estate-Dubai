import { logger, task } from "@trigger.dev/sdk/v3";

import { prisma } from "@/lib/prisma";
import { buildCampaignOpenerIdempotencyKey } from "@/whatsapp/idempotency";
import { sendOutboundTask } from "@trigger/send-outbound";

export interface StartCampaignPayload {
  campaignId: string;
}

export type StartCampaignResult =
  | { started: false; reason: string }
  | { started: true; conversationsTargeted: number };

/** Fixed spacing requirement between campaign opener sends, per operator instruction. */
const CAMPAIGN_SEND_SPACING_SECONDS = 90;

/**
 * Begins a campaign's outbound opener sends. Every send is a template
 * message (see send-outbound's isTemplate path) — campaign openers to leads
 * who haven't messaged first require a Meta-approved template, they can't be
 * free text. Spacing between sends is enforced via Trigger.dev's `delay` on
 * each individual trigger call — not a blocking sleep, so no worker sits
 * idle waiting; each send is its own independently-scheduled run.
 *
 * Idempotency (existing, unchanged): the opener's key is
 * out:campaign:{campaignId}:{leadId}, collision-proof per lead per campaign.
 * Running this twice for the same campaign is safe — every already-sent
 * opener gets blocked by send-outbound's idempotency check, not resent.
 */
export async function startCampaign(payload: StartCampaignPayload): Promise<StartCampaignResult> {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: payload.campaignId } });

  if (campaign.status !== "ACTIVE") {
    logger.log("start-campaign: not started, campaign is not ACTIVE", { status: campaign.status });
    return { started: false, reason: `campaign status is ${campaign.status}, not ACTIVE` };
  }
  if (campaign.templateStatus !== "APPROVED") {
    logger.log("start-campaign: not started, template is not APPROVED", {
      templateStatus: campaign.templateStatus,
    });
    return { started: false, reason: `template status is ${campaign.templateStatus}, not APPROVED` };
  }

  const conversations = await prisma.conversation.findMany({
    where: { campaignId: payload.campaignId },
    include: { lead: true },
  });

  for (const [index, conversation] of conversations.entries()) {
    const delaySeconds = index * CAMPAIGN_SEND_SPACING_SECONDS;

    await sendOutboundTask.trigger(
      {
        conversationId: conversation.id,
        campaignId: campaign.id,
        leadId: conversation.leadId,
        senderPhoneNumberId: campaign.senderPhoneNumberId,
        idempotencyKey: buildCampaignOpenerIdempotencyKey(campaign.id, conversation.leadId),
        isTemplate: true,
      },
      {
        concurrencyKey: campaign.senderPhoneNumberId,
        ...(delaySeconds > 0 ? { delay: `${delaySeconds}s` } : {}),
      },
    );
  }

  logger.log("start-campaign: openers scheduled", {
    campaignId: campaign.id,
    conversationsTargeted: conversations.length,
    spacingSeconds: CAMPAIGN_SEND_SPACING_SECONDS,
  });

  return { started: true, conversationsTargeted: conversations.length };
}

/**
 * Queue: concurrencyLimit 1 per campaign — one start-campaign run at a time
 * per campaign is enough; this task only schedules sends, it doesn't do the
 * sending itself, so there's no reason for more concurrency here. Callers
 * SHOULD trigger with `concurrencyKey: campaignId` to prevent the same
 * campaign being started twice concurrently.
 */
export const startCampaignTask = task({
  id: "start-campaign",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: async (payload: StartCampaignPayload, { ctx }) => {
    logger.log("start-campaign received", { payload, ctx });
    return startCampaign(payload);
  },
});
