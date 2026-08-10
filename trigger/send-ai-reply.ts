import { logger, task } from "@trigger.dev/sdk/v3";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { invokeSkill } from "@/skill/invoke";
import type { SkillInputMessage, SkillInvocationContext } from "@/skill/types";
import { classifyBehaviorState } from "@/whatsapp/behavior-state";
import { buildReplyIdempotencyKey } from "@/whatsapp/idempotency";
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
    };

/**
 * Fires 2 minutes after handle-inbound schedules it (see handle-inbound.ts).
 * The Skill is invoked HERE, fresh, at fire time — never at the moment the
 * message arrived — so a decision is always based on the conversation as it
 * actually stands 2 minutes later, not a stale snapshot.
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

  const result = await invokeSkill(context);

  await prisma.aiDecision.create({
    data: {
      conversationId: conversation.id,
      messageId: payload.triggeringMessageId,
      rawInput: context as unknown as Prisma.InputJsonValue,
      rawOutput: result.rawOutput,
      parseStatus: result.status === "success" ? "SUCCESS" : "PARSE_FAILURE",
      parsedDecision:
        result.status === "success"
          ? (result.decision as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });

  logger.log("send-ai-reply: AiDecision persisted", { status: result.status });

  if (result.status !== "success") {
    return { evaluated: true, status: result.status, replyTriggered: false };
  }

  if (result.decision.recommendedReply.kind !== "reply") {
    return { evaluated: true, status: result.status, replyTriggered: false };
  }

  if (!conversation.campaignId) {
    logger.log("send-ai-reply: Skill returned a reply but conversation has no campaign, not sending", {
      conversationId: conversation.id,
    });
    return {
      evaluated: true,
      status: result.status,
      replyTriggered: false,
      replySkipped: "conversation has no associated campaign",
    };
  }

  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: conversation.campaignId } });

  await sendOutboundTask.trigger(
    {
      conversationId: conversation.id,
      campaignId: campaign.id,
      leadId: conversation.leadId,
      senderPhoneNumberId: campaign.senderPhoneNumberId,
      idempotencyKey: buildReplyIdempotencyKey(conversation.id, payload.triggeringWaMessageId),
      body: result.decision.recommendedReply.text,
    },
    { concurrencyKey: campaign.senderPhoneNumberId },
  );

  return { evaluated: true, status: result.status, replyTriggered: true };
}

/**
 * Queue: concurrencyLimit 10 — independent conversations evaluate in
 * parallel. Callers MUST trigger with `concurrencyKey: conversationId` and
 * `delay: "2m"` — see handle-inbound.ts.
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
