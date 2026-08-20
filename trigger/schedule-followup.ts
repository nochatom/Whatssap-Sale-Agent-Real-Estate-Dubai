import { logger, task } from "@trigger.dev/sdk/v3";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { invokeSkill } from "@/skill/invoke";
import type { SkillDecision, SkillInputMessage, SkillInvocationContext } from "@/skill/types";
import { buildFollowUpIdempotencyKey } from "@/whatsapp/idempotency";
import { resolveSender } from "@trigger/resolve-sender";
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

export interface MaybeScheduleFollowUpParams {
  conversationId: string;
  leadId: string;
  /** Null for an organic conversation — there is then no campaign to source a follow-up interval from. */
  campaignId: string | null;
  decision: SkillDecision;
  /** Links the new FollowUp back to the AiDecision that produced this "wait" — FollowUp.triggerAiDecisionId. */
  triggerAiDecisionId?: string;
}

export type MaybeScheduleFollowUpResult =
  | { scheduled: false; reason: string }
  | { scheduled: true; followUpId: string; scheduledFor: Date };

/**
 * Creates and schedules a FollowUp when — and only when — the Skill's
 * decision explicitly asks for one: recommendedReply.kind ===
 * "do_not_follow_up_yet" (SKILL.md §9/§17). This is deliberately distinct
 * from "do_not_reply_yet", which is a passive wait (e.g. "just sent, too
 * soon") with no proactive re-engagement implied — only the named
 * follow-up variant creates a FollowUp row.
 *
 * The delay is always Campaign.followUpDelayMinutes — never hardcoded, never
 * parsed out of the Skill's free-text `trigger` field. No campaign, no
 * configured delay, or a non-positive delay all mean "cannot safely schedule
 * this" and are reported back via the result, never silently defaulted to a
 * guessed number.
 */
export async function maybeScheduleFollowUp(
  params: MaybeScheduleFollowUpParams,
): Promise<MaybeScheduleFollowUpResult> {
  if (params.decision.recommendedReply.kind !== "do_not_follow_up_yet") {
    return { scheduled: false, reason: "decision does not explicitly require a follow-up" };
  }

  if (!params.campaignId) {
    logger.log(
      "maybeScheduleFollowUp: no campaign, no configured follow-up interval, not scheduling",
      { conversationId: params.conversationId },
    );
    return {
      scheduled: false,
      reason: "conversation has no campaign to source a follow-up interval from",
    };
  }

  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: params.campaignId } });

  if (campaign.followUpDelayMinutes == null) {
    logger.log(
      "maybeScheduleFollowUp: campaign has no followUpDelayMinutes configured, not scheduling",
      { campaignId: campaign.id },
    );
    return { scheduled: false, reason: "campaign.followUpDelayMinutes is not configured" };
  }

  if (campaign.followUpDelayMinutes <= 0) {
    logger.warn(
      "maybeScheduleFollowUp: campaign.followUpDelayMinutes must be positive, not scheduling",
      { campaignId: campaign.id, followUpDelayMinutes: campaign.followUpDelayMinutes },
    );
    return { scheduled: false, reason: "campaign.followUpDelayMinutes must be positive" };
  }

  const scheduledFor = new Date(Date.now() + campaign.followUpDelayMinutes * 60_000);

  const followUp = await prisma.followUp.create({
    data: {
      conversationId: params.conversationId,
      leadId: params.leadId,
      scheduledFor,
      reason: params.decision.recommendedReply.reason,
      triggerAiDecisionId: params.triggerAiDecisionId,
    },
  });

  await scheduleFollowUp(followUp.id);

  logger.log("maybeScheduleFollowUp: FollowUp created and scheduled", {
    followUpId: followUp.id,
    scheduledFor,
  });

  return { scheduled: true, followUpId: followUp.id, scheduledFor };
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
    // Deliberately NOT calling maybeScheduleFollowUp again here even if the
    // fresh decision is again "do_not_follow_up_yet" — that would chain
    // follow-ups indefinitely. One follow-up per "wait" signal from
    // send-ai-reply is the cap, and nothing is configured to allow more (see
    // the Phase 2 report). This FollowUp is simply cancelled.
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: Skill says wait again, not auto-rescheduling (endless-loop guard)");
    return { actioned: false, reason: "Skill did not return a reply; not auto-rescheduling" };
  }

  const sender = await resolveSender(conversation);
  if (!sender) {
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: cannot send, no campaign and no known sender number", {
      conversationId: conversation.id,
    });
    return { actioned: false, reason: "no campaign and no known sender number for this conversation" };
  }

  await sendOutboundTask.trigger(
    {
      conversationId: conversation.id,
      campaignId: sender.campaignId,
      leadId: payload.leadId,
      senderPhoneNumberId: sender.senderPhoneNumberId,
      idempotencyKey: buildFollowUpIdempotencyKey(followUp.id),
      body: result.decision.recommendedReply.text,
    },
    { concurrencyKey: sender.senderPhoneNumberId },
  );

  await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "SENT" } });

  logger.log("schedule-followup: send-outbound triggered", { followUpId: followUp.id });

  return { actioned: true };
}

/**
 * Queue: concurrencyLimit 5. Callers MUST trigger with
 * `concurrencyKey: conversationId` to prevent two follow-ups being scheduled
 * concurrently for the same conversation. FollowUp.triggerRunId is written
 * by scheduleFollowUp() above, so handle-inbound can cancel it via
 * runs.cancel(triggerRunId) if the customer replies before this fires — see
 * handleInbound's cancelPendingFollowUps.
 *
 * FollowUp rows are created by maybeScheduleFollowUp() (called from
 * send-ai-reply.ts when the Skill's decision explicitly requires a
 * follow-up), which also calls scheduleFollowUp() to connect the new row to
 * this task.
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
