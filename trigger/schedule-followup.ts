import { logger, task } from "@trigger.dev/sdk/v3";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { invokeSkill } from "@/skill/invoke";
import type { SkillInputMessage, SkillInvocationContext } from "@/skill/types";
import { buildFollowUpIdempotencyKey } from "@/whatsapp/idempotency";
import { sendOutboundTask } from "@trigger/send-outbound";

export interface ScheduleFollowUpPayload {
  conversationId: string;
  leadId: string;
  followUpId: string;
}

export type ScheduleFollowUpResult =
  | { actioned: false; reason: string }
  | { actioned: true };

/**
 * Connects an EXISTING, already-created FollowUp row to Trigger.dev's actual
 * delay mechanism: triggers scheduleFollowUpTask to fire at followUp.scheduledFor
 * (an absolute Date, which .trigger()'s `delay` option accepts directly — no
 * duration math here), and writes the resulting run id onto
 * FollowUp.triggerRunId so handle-inbound can cancel it on an early reply.
 *
 * This function does NOT decide what scheduledFor should be and does not
 * create FollowUp rows — nothing in this codebase does that yet. There is no
 * configurable follow-up-interval source anywhere (SkillDecision.trigger is
 * free text; Campaign has no interval column), and guessing one would
 * violate the explicit "no hardcoded follow-up interval" constraint. See the
 * Phase 2 report for the exact schema addition this needs before anything
 * can call this function automatically.
 */
export async function scheduleFollowUp(followUpId: string): Promise<{ triggerRunId: string }> {
  const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });

  if (followUp.status !== "PENDING") {
    throw new Error(
      `Cannot schedule FollowUp ${followUpId}: status is ${followUp.status}, not PENDING`,
    );
  }

  const handle = await scheduleFollowUpTask.trigger(
    { conversationId: followUp.conversationId, leadId: followUp.leadId, followUpId: followUp.id },
    { delay: followUp.scheduledFor, concurrencyKey: followUp.conversationId },
  );

  await prisma.followUp.update({
    where: { id: followUp.id },
    data: { triggerRunId: handle.id },
  });

  logger.log("schedule-followup: scheduled", {
    followUpId: followUp.id,
    scheduledFor: followUp.scheduledFor,
    triggerRunId: handle.id,
  });

  return { triggerRunId: handle.id };
}

/**
 * Fires when a previously-scheduled FollowUp wakes up. Nothing here sends a
 * pre-written message — the Skill is the sole source of truth for what to say
 * (per the original constraint: no hardcoded message copy or follow-up
 * logic), so waking up means re-invoking the Skill against the conversation's
 * current state as WhatsApp behavior state F ("previously engaged, suddenly
 * silent"), not replaying something decided at schedule time.
 *
 * Wake-time re-verification: cancellation races (handle-inbound calling
 * runs.cancel on reply), so this is the second-layer guard — if the customer
 * replied after this FollowUp was created, cancel and do nothing.
 *
 * If the fresh decision is still "wait", this does NOT auto-reschedule.
 * Computing a new scheduledFor would mean inventing a follow-up interval —
 * there is no structured duration anywhere in the system (SkillDecision's
 * `trigger` field is free text, and Campaign has no interval column) — and
 * inventing one would violate "no hardcoded follow-up interval". The
 * FollowUp is marked CANCELLED and the gap is surfaced, not silently papered
 * over with a guessed number.
 */
export async function runScheduledFollowUp(
  payload: ScheduleFollowUpPayload,
): Promise<ScheduleFollowUpResult> {
  const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: payload.followUpId } });

  if (followUp.status !== "PENDING") {
    logger.log("schedule-followup: no-op, already handled", { status: followUp.status });
    return { actioned: false, reason: `follow-up already ${followUp.status}` };
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: payload.conversationId },
    include: { lead: true },
  });

  if (conversation.lastInboundAt && conversation.lastInboundAt > followUp.createdAt) {
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: cancelled, customer already replied since scheduling", {
      followUpId: followUp.id,
    });
    return { actioned: false, reason: "customer replied since scheduling" };
  }

  const history = await prisma.message.findMany({
    where: { conversationId: payload.conversationId },
    orderBy: { createdAt: "asc" },
  });

  const skillMessages: SkillInputMessage[] = history.map((m) => ({
    direction: m.direction === "INBOUND" ? "inbound" : "outbound",
    body: m.body ?? "",
    sentAt: m.createdAt.toISOString(),
  }));

  const context: SkillInvocationContext = {
    conversationId: conversation.id,
    behaviorState: "F",
    messages: skillMessages,
    lead: { phoneE164: conversation.lead.phoneE164, knownFacts: {} },
  };

  const result = await invokeSkill(context);

  await prisma.aiDecision.create({
    data: {
      conversationId: conversation.id,
      messageId: null,
      rawInput: context as unknown as Prisma.InputJsonValue,
      rawOutput: result.rawOutput,
      parseStatus: result.status === "success" ? "SUCCESS" : "PARSE_FAILURE",
      parsedDecision:
        result.status === "success"
          ? (result.decision as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });

  if (result.status !== "success") {
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: Skill call did not parse, not auto-rescheduling", {
      reason: result.reason,
    });
    return { actioned: false, reason: "Skill call did not parse; not auto-rescheduling" };
  }

  if (result.decision.recommendedReply.kind !== "reply") {
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: Skill says wait again, not auto-rescheduling (no interval source)");
    return { actioned: false, reason: "Skill did not return a reply; not auto-rescheduling" };
  }

  if (!conversation.campaignId) {
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: cannot send, conversation has no associated campaign", {
      conversationId: conversation.id,
    });
    return { actioned: false, reason: "conversation has no associated campaign" };
  }

  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: conversation.campaignId } });

  await sendOutboundTask.trigger(
    {
      conversationId: conversation.id,
      campaignId: campaign.id,
      leadId: payload.leadId,
      senderPhoneNumberId: campaign.senderPhoneNumberId,
      idempotencyKey: buildFollowUpIdempotencyKey(followUp.id),
      body: result.decision.recommendedReply.text,
    },
    { concurrencyKey: campaign.senderPhoneNumberId },
  );

  await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "SENT" } });

  logger.log("schedule-followup: send-outbound triggered", { followUpId: followUp.id });

  return { actioned: true };
}

/**
 * Queue: concurrencyLimit 5. Callers MUST trigger with
 * `concurrencyKey: conversationId` to prevent two follow-ups being scheduled
 * concurrently for the same conversation. The creator of a FollowUp row must
 * write the returned trigger handle's `.id` to FollowUp.triggerRunId, so
 * handle-inbound can cancel it via runs.cancel(triggerRunId) if the customer
 * replies before this fires — see handleInbound's cancelPendingFollowUps.
 *
 * Nothing in this codebase creates FollowUp rows or schedules this task yet
 * (see the report on why: no follow-up interval source exists). This task is
 * a complete, tested orchestration primitive ready for that trigger point.
 */
export const scheduleFollowUpTask = task({
  id: "schedule-followup",
  queue: { concurrencyLimit: 5 },
  retry: { maxAttempts: 3 },
  run: async (payload: ScheduleFollowUpPayload, { ctx }) => {
    logger.log("schedule-followup received", { payload, ctx });
    return runScheduledFollowUp(payload);
  },
});
