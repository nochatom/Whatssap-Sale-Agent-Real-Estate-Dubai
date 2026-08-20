import { logger, task } from "@trigger.dev/sdk/v3";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { invokeSkill, isRetryableProviderUnavailable, nextCloudflareQuotaResetAt } from "@/skill/invoke";
import type { SkillInputMessage, SkillInvocationContext } from "@/skill/types";
import { classifyBehaviorState } from "@/whatsapp/behavior-state";
import { buildReplyIdempotencyKey } from "@/whatsapp/idempotency";
import { resolveSender } from "@trigger/resolve-sender";
import { maybeScheduleFollowUp } from "@trigger/schedule-followup";
import { sendOutboundTask } from "@trigger/send-outbound";

export interface SendAiReplyPayload {
  conversationId: string;
  triggeringMessageId: string;
  triggeringWaMessageId: string;
}

export type SendAiReplyResult =
  | { evaluated: false; reason: string }
  | {
      evaluated: true;
      status: "success" | "parse_failure";
      replyTriggered: boolean;
      replySkipped?: string;
      followUpScheduled?: boolean;
      /** Set when no AI provider was reachable and this message was rescheduled
       * for after Cloudflare's daily quota reset instead of being dropped. */
      retryScheduledAt?: string;
    };

/**
 * Fires a randomized 3-5s after handle-inbound schedules it (see
 * handle-inbound.ts's MIN_REPLY_DELAY_MS/MAX_REPLY_DELAY_MS). The Skill is
 * invoked HERE, fresh, at fire time — never at the moment the message
 * arrived — so a decision is always based on the conversation as it
 * actually stands moments later, not a stale snapshot.
 *
 * Duplicate-reply prevention: if a second inbound message arrived in the
 * meantime, THIS run's triggeringMessageId is no longer the conversation's
 * latest inbound message, and it self-aborts without invoking the Skill or
 * persisting anything. The newer message's own handle-inbound → send-ai-
 * reply chain (already scheduled independently) is the one that will act. No
 * cancellation is needed for this to be correct — every scheduled run checks
 * "am I still the latest?" independently at its own fire time, so only the
 * last one in a burst ever proceeds.
 */
export async function sendAiReply(payload: SendAiReplyPayload): Promise<SendAiReplyResult> {
  const taskStartedAt = Date.now();
  const latestInbound = await prisma.message.findFirst({
    where: { conversationId: payload.conversationId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
  });

  if (!latestInbound || latestInbound.id !== payload.triggeringMessageId) {
    logger.log("send-ai-reply: stale, a newer inbound message exists, skipping", {
      conversationId: payload.conversationId,
      triggeringMessageId: payload.triggeringMessageId,
      latestInboundId: latestInbound?.id ?? null,
    });
    return {
      evaluated: false,
      reason: "a newer inbound message arrived; its own scheduled run will handle it",
    };
  }

  const behaviorState = classifyBehaviorState(latestInbound);
  if (behaviorState === null) {
    logger.log("send-ai-reply: triggering message is no longer classifiable, skipping", {
      type: latestInbound.type,
    });
    return { evaluated: false, reason: "triggering message is not classifiable" };
  }

  const dbFetchStartedAt = Date.now();
  const [conversation, history] = await Promise.all([
    prisma.conversation.findUniqueOrThrow({
      where: { id: payload.conversationId },
      include: { lead: true },
    }),
    prisma.message.findMany({
      where: { conversationId: payload.conversationId },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const dbFetchMs = Date.now() - dbFetchStartedAt;

  const skillMessages: SkillInputMessage[] = history.map((m) => ({
    direction: m.direction === "INBOUND" ? "inbound" : "outbound",
    body: m.body ?? "",
    sentAt: m.createdAt.toISOString(),
  }));

  const context: SkillInvocationContext = {
    conversationId: conversation.id,
    behaviorState,
    messages: skillMessages,
    lead: { phoneE164: conversation.lead.phoneE164, knownFacts: {} },
  };

  // Only needed later if the decision turns out to be a "reply" for a
  // campaign-attached conversation, but it doesn't depend on the AI result —
  // start it now so it resolves for free inside invokeSkill's ~30s call
  // instead of adding its own round trip afterward.
  const campaignPromise = conversation.campaignId
    ? prisma.campaign.findUniqueOrThrow({ where: { id: conversation.campaignId } })
    : null;

  const invokeSkillStartedAt = Date.now();
  const [result, prefetchedCampaign] = await Promise.all([invokeSkill(context), campaignPromise]);
  const invokeSkillMs = Date.now() - invokeSkillStartedAt;

  // Diagnostic-only debug block appended to rawInput (never read by the
  // WhatsApp send path, the UI, or SkillDecision — purely for measuring the
  // ~46s real-world latency reported after the demo-link fix). Remove once
  // the bottleneck investigation is done.
  const debugTimingsMs = {
    preprocessingMs: dbFetchStartedAt - taskStartedAt,
    dbFetchMs,
    invokeSkillMs,
    invokeSkillBreakdown: result.timingsMs ?? null,
  };

  const aiDecisionPersistStartedAt = Date.now();
  const aiDecision = await prisma.aiDecision.create({
    data: {
      conversationId: conversation.id,
      messageId: payload.triggeringMessageId,
      rawInput: { ...context, _debugTimingsMs: debugTimingsMs } as unknown as Prisma.InputJsonValue,
      rawOutput: result.rawOutput,
      parseStatus: result.status === "success" ? "SUCCESS" : "PARSE_FAILURE",
      parsedDecision:
        result.status === "success"
          ? (result.decision as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
  const aiDecisionPersistMs = Date.now() - aiDecisionPersistStartedAt;

  logger.log("send-ai-reply: AiDecision persisted", {
    status: result.status,
    debugTimingsMs: { ...debugTimingsMs, aiDecisionPersistMs },
  });

  if (result.status !== "success") {
    if (isRetryableProviderUnavailable(result)) {
      const retryAt = nextCloudflareQuotaResetAt();
      await sendAiReplyTask.trigger(
        {
          conversationId: payload.conversationId,
          triggeringMessageId: payload.triggeringMessageId,
          triggeringWaMessageId: payload.triggeringWaMessageId,
        },
        { delay: retryAt, concurrencyKey: payload.conversationId },
      );
      logger.log("send-ai-reply: no AI provider reachable, rescheduled after Cloudflare's quota reset", {
        conversationId: conversation.id,
        retryAt: retryAt.toISOString(),
      });
      return {
        evaluated: true,
        status: result.status,
        replyTriggered: false,
        retryScheduledAt: retryAt.toISOString(),
      };
    }
    return { evaluated: true, status: result.status, replyTriggered: false };
  }

  if (result.decision.recommendedReply.kind === "do_not_follow_up_yet") {
    const followUp = await maybeScheduleFollowUp({
      conversationId: conversation.id,
      leadId: conversation.leadId,
      campaignId: conversation.campaignId,
      decision: result.decision,
      triggerAiDecisionId: aiDecision.id,
    });
    return {
      evaluated: true,
      status: result.status,
      replyTriggered: false,
      followUpScheduled: followUp.scheduled,
    };
  }

  if (result.decision.recommendedReply.kind !== "reply") {
    return { evaluated: true, status: result.status, replyTriggered: false };
  }

  const sender = await resolveSender(conversation, prefetchedCampaign);
  if (!sender) {
    logger.log(
      "send-ai-reply: Skill returned a reply but there is no campaign and no known sender number, not sending",
      { conversationId: conversation.id },
    );
    return {
      evaluated: true,
      status: result.status,
      replyTriggered: false,
      replySkipped: "no campaign and no known sender number for this conversation",
    };
  }
  const { campaignId, senderPhoneNumberId } = sender;

  const sendOutboundTriggerStartedAt = Date.now();
  await sendOutboundTask.trigger(
    {
      conversationId: conversation.id,
      campaignId,
      leadId: conversation.leadId,
      senderPhoneNumberId,
      idempotencyKey: buildReplyIdempotencyKey(conversation.id, payload.triggeringWaMessageId),
      body: result.decision.recommendedReply.text,
    },
    { concurrencyKey: senderPhoneNumberId },
  );
  logger.log("send-ai-reply: sendOutboundTask triggered", {
    debugTimingsMs: {
      ...debugTimingsMs,
      aiDecisionPersistMs,
      sendOutboundTriggerMs: Date.now() - sendOutboundTriggerStartedAt,
      totalSendAiReplyMs: Date.now() - taskStartedAt,
    },
  });

  return { evaluated: true, status: result.status, replyTriggered: true };
}

/**
 * Queue: concurrencyLimit 10 — independent conversations evaluate in
 * parallel. Callers MUST trigger with `concurrencyKey: conversationId` and
 * a `delay` — see handle-inbound.ts's randomized 3-5s scheduling.
 */
export const sendAiReplyTask = task({
  id: "send-ai-reply",
  queue: { concurrencyLimit: 10 },
  retry: { maxAttempts: 3 },
  run: async (payload: SendAiReplyPayload, { ctx }) => {
    logger.log("send-ai-reply received", { payload, ctx });
    return sendAiReply(payload);
  },
});
