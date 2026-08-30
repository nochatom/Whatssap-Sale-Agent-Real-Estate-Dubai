import { logger, task } from "@trigger.dev/sdk/v3";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { invokeSkill } from "@/skill/invoke";
import { fetchReachedMilestones } from "@/skill/milestones";
import type { SkillDecision, SkillInputMessage, SkillInvocationContext } from "@/skill/types";
import { buildFollowUpIdempotencyKey } from "@/whatsapp/idempotency";
import { resolveSender } from "@trigger/resolve-sender";
import { sendOutboundTask } from "@trigger/send-outbound";

// Fixed, not configurable per campaign (unlike Campaign.followUpDelayMinutes,
// which drives the separate AI-decision-triggered follow-up below) — the
// user specified an exact 48-hour cadence for this sequence.
const CAMPAIGN_FOLLOWUP_DELAY_HOURS = 48;

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

export interface StartCampaignFollowUpSequenceParams {
  conversationId: string;
  leadId: string;
  campaignId: string;
}

/**
 * Creates and schedules one step of the fixed, campaign-level 2-step follow-
 * up sequence (Follow-up #1, then a Final Follow-up 48h after that) —
 * distinct from maybeScheduleFollowUp below, which creates the OTHER kind of
 * FollowUp row (sequenceStep left null) only when the Skill itself
 * explicitly asks for one. This one is unconditional: called once right
 * after a campaign's template-opener send (see trigger/send-outbound.ts) for
 * step 1, and again from within runScheduledFollowUp itself, after step 1
 * successfully sends, for step 2. Always a fixed 48h out — never sourced
 * from Campaign.followUpDelayMinutes, which is a different, unrelated
 * setting for the other follow-up mechanism.
 */
export async function startCampaignFollowUpSequence(
  params: StartCampaignFollowUpSequenceParams,
  sequenceStep: 1 | 2 = 1,
): Promise<{ followUpId: string; scheduledFor: Date }> {
  const scheduledFor = new Date(Date.now() + CAMPAIGN_FOLLOWUP_DELAY_HOURS * 60 * 60_000);

  const followUp = await prisma.followUp.create({
    data: {
      conversationId: params.conversationId,
      leadId: params.leadId,
      scheduledFor,
      reason: `campaign follow-up sequence: step ${sequenceStep}`,
      sequenceStep,
    },
  });

  await scheduleFollowUp(followUp.id);

  logger.log("schedule-followup: campaign follow-up sequence step scheduled", {
    followUpId: followUp.id,
    campaignId: params.campaignId,
    sequenceStep,
    scheduledFor,
  });

  return { followUpId: followUp.id, scheduledFor };
}

export interface StartCampaignFollowUpSequenceTaskPayload extends StartCampaignFollowUpSequenceParams {
  sequenceStep?: 1 | 2;
}

/**
 * Queue: concurrencyLimit 10. Exists solely so trigger/send-outbound.ts can
 * start the campaign follow-up sequence WITHOUT importing this file
 * directly — this file already imports sendOutboundTask FROM send-outbound.ts
 * (to actually send a follow-up's message), so a direct import in the other
 * direction would be circular. send-outbound.ts triggers this task by its
 * string id (tasks.trigger) instead of importing the object. Called as a
 * plain function (startCampaignFollowUpSequence, not this task) from within
 * this same file when scheduling step 2 after step 1 sends — no cycle there.
 */
export const startCampaignFollowUpSequenceTask = task({
  id: "start-campaign-followup-sequence",
  queue: { concurrencyLimit: 10 },
  retry: { maxAttempts: 3 },
  run: async (payload: StartCampaignFollowUpSequenceTaskPayload) => {
    return startCampaignFollowUpSequence(payload, payload.sequenceStep ?? 1);
  },
});

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

  // Two additional stop conditions that ONLY apply to the fixed campaign
  // sequence (sequenceStep set) — the older AI-decision-triggered follow-up
  // (sequenceStep null) is untouched by either check, unchanged from its
  // original behavior above and below.
  let campaignFollowUpStage: "first" | "final" | undefined;
  if (followUp.sequenceStep != null) {
    const reachedMilestones = await fetchReachedMilestones(conversation.id);
    if (reachedMilestones.length > 0) {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
      logger.log("schedule-followup: cancelled, conversation reached a protected milestone", {
        followUpId: followUp.id,
        reachedMilestones,
      });
      return { actioned: false, reason: "conversation reached a protected milestone" };
    }

    const campaign = conversation.campaignId
      ? await prisma.campaign.findUnique({ where: { id: conversation.campaignId } })
      : null;
    if (!campaign?.campaignFollowUpEnabled) {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
      logger.log("schedule-followup: cancelled, campaign follow-up is no longer enabled", {
        followUpId: followUp.id,
        campaignId: conversation.campaignId,
      });
      return { actioned: false, reason: "campaign follow-up is no longer enabled" };
    }

    campaignFollowUpStage = followUp.sequenceStep === 1 ? "first" : "final";
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
    ...(campaignFollowUpStage ? { campaignFollowUp: { stage: campaignFollowUpStage } } : {}),
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

  // Re-verify freshness right before sending. The reply-guard above ran
  // BEFORE invokeSkill — which can take tens of seconds across the
  // Ox Alpha -> Qwen -> Cloudflare fallback chain — so a customer reply
  // arriving during that call is invisible to that earlier check. Without
  // this second read, a stale follow-up (e.g. a "checking in on your video"
  // re-engagement) can still land after the customer has already moved the
  // conversation on to something else, because it already cleared the only
  // guard that would have caught it.
  const freshConversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    select: { lastInboundAt: true },
  });
  if (freshConversation.lastInboundAt && freshConversation.lastInboundAt > followUp.createdAt) {
    await prisma.followUp.update({ where: { id: followUp.id }, data: { status: "CANCELLED" } });
    logger.log("schedule-followup: cancelled just before send, customer replied while the Skill call was in flight", {
      followUpId: followUp.id,
    });
    return { actioned: false, reason: "customer replied while the follow-up's Skill call was in flight" };
  }

  await sendOutboundTask.trigger(
    {
      conversationId: conversation.id,
      campaignId: sender.campaignId,
      leadId: payload.leadId,
      senderPhoneNumberId: sender.senderPhoneNumberId,
      idempotencyKey: buildFollowUpIdempotencyKey(followUp.id),
      body: result.decision.recommendedReply.text,
      // Lets send-outbound re-check for a reply immediately before it
      // actually sends — the fresh check above only covers up to the
      // moment this task is triggered, not the time it then spends queued
      // (concurrencyLimit 1 per sender) before it runs. Applies identically
      // whether this is the fixed 48h/48h sequence or the organic
      // mechanism — both share this one call site.
      followUpGuard: { followUpId: followUp.id, createdAt: followUp.createdAt.toISOString() },
    },
    { concurrencyKey: sender.senderPhoneNumberId },
  );

  // Advance the fixed campaign sequence BEFORE marking this FollowUp SENT —
  // if scheduling the next step throws, a Trigger.dev retry should re-enter
  // this whole function (status still PENDING) and try again, rather than
  // silently getting stuck with no Final Follow-up ever scheduled.
  // Re-triggering send-outbound again on that retry is already safe: its
  // idempotency key is unchanged (same followUp.id), so a duplicate trigger
  // is a no-op at the database layer — the same guarantee this file already
  // relies on elsewhere. Exactly one further step: after step 1 sends,
  // schedule step 2; after step 2 sends, the sequence is over for this lead.
  if (followUp.sequenceStep === 1 && conversation.campaignId) {
    await startCampaignFollowUpSequence(
      { conversationId: conversation.id, leadId: payload.leadId, campaignId: conversation.campaignId },
      2,
    );
  }

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
