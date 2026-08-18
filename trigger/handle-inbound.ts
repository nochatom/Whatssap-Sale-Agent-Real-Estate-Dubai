import { logger, runs, task } from "@trigger.dev/sdk/v3";

import { prisma } from "@/lib/prisma";
import { classifyBehaviorState } from "@/whatsapp/behavior-state";
import { sendAiReplyTask } from "@trigger/send-ai-reply";

export interface HandleInboundPayload {
  conversationId: string;
  messageId: string;
  waMessageId: string;
}

export type HandleInboundResult =
  | { invoked: false; reason: string }
  | { invoked: true; replyScheduled: true };

export { classifyBehaviorState };

/**
 * Any real inbound message means the customer is no longer silent — cancel
 * every PENDING FollowUp for this conversation so schedule-followup doesn't
 * fire a stale re-engagement message on top of a live conversation.
 * Cancellation races with the follow-up actually firing (Trigger.dev's
 * runs.cancel is best-effort), which is why schedule-followup also
 * re-verifies conversation state itself at wake time — this is the first of
 * the two required layers, not the only one.
 */
async function cancelPendingFollowUps(conversationId: string): Promise<void> {
  const pending = await prisma.followUp.findMany({
    where: { conversationId, status: "PENDING" },
  });

  for (const followUp of pending) {
    if (followUp.triggerRunId) {
      try {
        await runs.cancel(followUp.triggerRunId);
      } catch (error) {
        logger.warn("handle-inbound: failed to cancel FollowUp run, relying on wake-time re-check", {
          followUpId: followUp.id,
          triggerRunId: followUp.triggerRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
  }
}

// Randomized 3-5s so replies don't all land at the exact same offset.
const MIN_REPLY_DELAY_MS = 3000;
const MAX_REPLY_DELAY_MS = 5000;

/**
 * Classifies the triggering message and, if classifiable, cancels any
 * pending follow-up and schedules send-ai-reply 3-5 seconds out. Does NOT
 * invoke the Skill or send anything itself — that all happens in
 * send-ai-reply, at fire time, against whatever the conversation looks like
 * then (never a decision made here and replayed later).
 */
export async function handleInbound(payload: HandleInboundPayload): Promise<HandleInboundResult> {
  const message = await prisma.message.findUniqueOrThrow({ where: { id: payload.messageId } });

  const behaviorState = classifyBehaviorState(message);
  if (behaviorState === null) {
    logger.log("handle-inbound: message type not classifiable yet, skipping", {
      type: message.type,
    });
    return { invoked: false, reason: "unclassifiable message type" };
  }

  await cancelPendingFollowUps(payload.conversationId);

  const delayMs = MIN_REPLY_DELAY_MS + Math.random() * (MAX_REPLY_DELAY_MS - MIN_REPLY_DELAY_MS);
  const delayDate = new Date(Date.now() + delayMs);

  await sendAiReplyTask.trigger(
    {
      conversationId: payload.conversationId,
      triggeringMessageId: payload.messageId,
      triggeringWaMessageId: payload.waMessageId,
    },
    { delay: delayDate, concurrencyKey: payload.conversationId },
  );

  logger.log("handle-inbound: send-ai-reply scheduled", {
    conversationId: payload.conversationId,
    delayMs: Math.round(delayMs),
  });

  return { invoked: true, replyScheduled: true };
}

/**
 * Queue: concurrencyLimit 10 — inbound messages across unrelated conversations
 * should process in parallel so the webhook stays fast. Callers MUST trigger
 * with `concurrencyKey: conversationId` so two rapid inbound messages in the
 * same conversation can't race on cancelling a pending FollowUp.
 */
export const handleInboundTask = task({
  id: "handle-inbound",
  queue: { concurrencyLimit: 10 },
  retry: { maxAttempts: 3 },
  run: async (payload: HandleInboundPayload, { ctx }) => {
    logger.log("handle-inbound received", { payload, ctx });
    return handleInbound(payload);
  },
});
