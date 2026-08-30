import { logger, task, tasks, type AnyTask } from "@trigger.dev/sdk/v3";

import { prisma } from "@/lib/prisma";
import { runComplianceGate, type ComplianceFailure } from "@/compliance/checks";
import { sendMessage, sendMediaMessage, sendTemplateMessage } from "@/whatsapp/transport";
import type { MediaKind } from "@/whatsapp/types";

export interface SendOutboundMedia {
  /** Meta media id from uploadMedia() — never raw bytes here. */
  mediaId: string;
  kind: MediaKind;
  mimeType: string;
  /** Only meaningful for kind "document". */
  filename?: string;
}

export interface SendOutboundPayload {
  conversationId: string;
  /**
   * Absent for an organically initiated conversation (no Campaign) — the
   * caller resolves senderPhoneNumberId from Conversation.senderPhoneNumberId
   * instead in that case. A template send always requires a campaignId; this
   * throws if isTemplate is true and campaignId is missing.
   */
  campaignId?: string;
  leadId: string;
  senderPhoneNumberId: string;
  idempotencyKey: string;
  /**
   * Free text to send, or the caption for a media send. Required when
   * isTemplate is false and media is absent. Ignored for a template send —
   * the template's approved copy is what's sent, not this field.
   */
  body?: string;
  /**
   * Template name comes from campaign.templateName (database config, not
   * invented here). Template language comes from WHATSAPP_TEMPLATE_LANGUAGE
   * (environment config) — if unset, this throws rather than guessing a
   * language. The template's single body variable ({{1}}) is filled with
   * the lead's name, falling back to "there" when the lead has none.
   */
  isTemplate?: boolean;
  /** Mutually exclusive with isTemplate — a media send is never a template. */
  media?: SendOutboundMedia;
  /**
   * Internal Message.id this send is a quoted reply to. Resolved to that
   * message's waMessageId before calling Meta (Meta's context.message_id
   * must be Meta's own id, not ours). If the target message has no
   * waMessageId (shouldn't normally happen), the reply reference is still
   * persisted locally but omitted from the actual Meta API call rather than
   * sending a request Meta would reject.
   */
  replyToMessageId?: string;
  /**
   * Present ONLY when this send is a scheduled follow-up (either the fixed
   * 48h/48h campaign sequence or the organic, AI-decision-triggered one) —
   * set by schedule-followup.ts, never by send-ai-reply.ts or a campaign
   * opener. Enables one last staleness check immediately before the actual
   * WhatsApp call: schedule-followup.ts already re-checks for a customer
   * reply right before triggering this task, but this task itself is
   * queued (concurrencyLimit 1 per sender) and can sit behind other sends
   * for that same number — long enough for a reply to arrive in the
   * meantime, after schedule-followup's own check already passed. Without
   * this, a follow-up already sitting in that queue would still go out
   * on top of a reply the customer just sent.
   */
  followUpGuard?: { followUpId: string; createdAt: string };
}

export type SendOutboundResult =
  | { sent: false; blockedBy: ComplianceFailure }
  | { sent: false; skippedStale: true }
  | { sent: true; waMessageId: string; messageId: string };

/**
 * The single centralized send path. Every outbound WhatsApp message —
 * campaign opener (template), AI reply, or follow-up (both free-text) —
 * goes through this function, and this function always runs the compliance
 * gate immediately before calling sendMessage/sendTemplateMessage. Nothing
 * outside this file may call those transport functions directly.
 *
 * Idempotency: the Message row is created only AFTER a successful send (not
 * reserved beforehand) — a retried run re-checks the gate, finds the row
 * from the prior attempt via Message.idempotencyKey, and checkIdempotency
 * blocks the duplicate. This is the existing, already-documented design.
 */
export async function sendOutbound(payload: SendOutboundPayload): Promise<SendOutboundResult> {
  const taskStartedAt = Date.now();
  const isTemplate = payload.isTemplate ?? false;

  if (!isTemplate && !payload.body && !payload.media) {
    throw new Error("sendOutbound: body or media is required for a non-template send");
  }
  if (isTemplate && !payload.campaignId) {
    throw new Error("sendOutbound: a template send requires campaignId — there is no organic template");
  }
  if (isTemplate && payload.media) {
    throw new Error("sendOutbound: a template send cannot also carry media — there is no such Meta message shape");
  }

  const dbFetchStartedAt = Date.now();
  const [lead, campaign, conversation] = await Promise.all([
    prisma.lead.findUniqueOrThrow({ where: { id: payload.leadId } }),
    payload.campaignId
      ? prisma.campaign.findUniqueOrThrow({ where: { id: payload.campaignId } })
      : Promise.resolve(null),
    prisma.conversation.findUniqueOrThrow({ where: { id: payload.conversationId } }),
  ]);
  const dbFetchMs = Date.now() - dbFetchStartedAt;

  const gateStartedAt = Date.now();
  const gate = await runComplianceGate({
    phoneE164: lead.phoneE164,
    lead,
    campaign,
    conversation,
    idempotencyKey: payload.idempotencyKey,
    isTemplate,
  });
  const gateMs = Date.now() - gateStartedAt;

  if (!gate.passed) {
    logger.log("send-outbound: blocked by compliance gate", {
      conversationId: payload.conversationId,
      failedCheck: gate.failedCheck,
    });
    return { sent: false, blockedBy: gate.failedCheck as ComplianceFailure };
  }

  // Last-moment freshness check, follow-up sends only. This is the true
  // point of no return — nothing meaningful delays execution between here
  // and the actual Meta API call below — so a fresh read here catches a
  // reply that landed while this task was queued, which an earlier check
  // (made before this task was even triggered) cannot see.
  if (payload.followUpGuard) {
    const freshConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: payload.conversationId },
      select: { lastInboundAt: true },
    });
    const followUpCreatedAt = new Date(payload.followUpGuard.createdAt);
    if (freshConversation.lastInboundAt && freshConversation.lastInboundAt > followUpCreatedAt) {
      await prisma.followUp.update({
        where: { id: payload.followUpGuard.followUpId },
        data: { status: "CANCELLED" },
      });
      logger.log(
        "send-outbound: cancelled a stale follow-up immediately before sending — customer replied while it was queued",
        { followUpId: payload.followUpGuard.followUpId, conversationId: payload.conversationId },
      );
      return { sent: false, skippedStale: true };
    }
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not set");
  }

  // Resolve our internal replyToMessageId to Meta's own wamid for the
  // context.message_id field — Meta doesn't know our ids. If the target
  // message has no waMessageId, the reply is still persisted locally below
  // but silently omitted from the actual Meta call rather than sending a
  // request Meta would reject outright.
  let contextMessageId: string | undefined;
  if (payload.replyToMessageId) {
    const replyTarget = await prisma.message.findUnique({
      where: { id: payload.replyToMessageId },
      select: { waMessageId: true },
    });
    contextMessageId = replyTarget?.waMessageId ?? undefined;
  }

  const whatsappCallStartedAt = Date.now();
  let sendResult: { waMessageId: string };
  let persistedBody: string | null;
  let persistedType: string;
  let persistedTemplateName: string | null;
  let persistedMediaId: string | null = null;
  let persistedMimeType: string | null = null;
  let persistedFilename: string | null = null;

  if (isTemplate) {
    // Guaranteed non-null: validated above (isTemplate implies campaignId
    // was required), this is just TS not narrowing across the Promise.all.
    if (!campaign) {
      throw new Error("sendOutbound: template send but no campaign was resolved");
    }
    const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE;
    if (!templateLanguage) {
      throw new Error(
        "WHATSAPP_TEMPLATE_LANGUAGE is not set — required to send a template message, refusing to guess a language",
      );
    }
    sendResult = await sendTemplateMessage({
      to: lead.phoneE164,
      phoneNumberId: payload.senderPhoneNumberId,
      accessToken,
      templateName: campaign.templateName,
      templateLanguage,
      bodyParams: [lead.name ?? "there"],
    });
    persistedBody = null;
    persistedType = "template";
    persistedTemplateName = campaign.templateName;
  } else if (payload.media) {
    sendResult = await sendMediaMessage({
      to: lead.phoneE164,
      phoneNumberId: payload.senderPhoneNumberId,
      accessToken,
      mediaId: payload.media.mediaId,
      kind: payload.media.kind,
      caption: payload.body,
      filename: payload.media.filename,
      contextMessageId,
    });
    persistedBody = payload.body ?? null;
    persistedType = payload.media.kind;
    persistedTemplateName = null;
    persistedMediaId = payload.media.mediaId;
    persistedMimeType = payload.media.mimeType;
    persistedFilename = payload.media.filename ?? null;
  } else {
    sendResult = await sendMessage({
      to: lead.phoneE164,
      body: payload.body as string,
      phoneNumberId: payload.senderPhoneNumberId,
      accessToken,
      contextMessageId,
    });
    persistedBody = payload.body as string;
    persistedType = "text";
    persistedTemplateName = null;
  }

  const whatsappCallMs = Date.now() - whatsappCallStartedAt;

  // message.create and conversation.update are independent writes — the
  // update only sets lastOutboundAt and never needs the created message's
  // id — so they run concurrently instead of one after the other.
  const dbWriteStartedAt = Date.now();
  const [message] = await Promise.all([
    prisma.message.create({
      data: {
        conversationId: payload.conversationId,
        direction: "OUTBOUND",
        waMessageId: sendResult.waMessageId,
        idempotencyKey: payload.idempotencyKey,
        type: persistedType,
        body: persistedBody,
        templateName: persistedTemplateName,
        mediaId: persistedMediaId,
        mimeType: persistedMimeType,
        filename: persistedFilename,
        replyToMessageId: payload.replyToMessageId ?? null,
        status: "SENT",
      },
    }),
    prisma.conversation.update({
      where: { id: payload.conversationId },
      data: { lastOutboundAt: new Date() },
    }),
  ]);
  const dbWriteMs = Date.now() - dbWriteStartedAt;

  logger.log("send-outbound: sent", {
    messageId: message.id,
    waMessageId: sendResult.waMessageId,
    isTemplate,
    debugTimingsMs: {
      preprocessingMs: dbFetchStartedAt - taskStartedAt,
      dbFetchMs,
      gateMs,
      whatsappCallMs,
      dbWriteMs,
      totalSendOutboundMs: Date.now() - taskStartedAt,
    },
  });

  // A template send only ever happens for a campaign's opening message
  // (validated above: isTemplate requires campaignId, and nothing else in
  // this codebase sends a template). If that campaign has the fixed 2-stage
  // follow-up sequence enabled, start it now. Triggered by string task id
  // (not a direct import — see startCampaignFollowUpSequenceTask's own
  // comment for why) and wrapped so a scheduling failure here can never
  // affect the campaign send that already succeeded, matching the existing
  // non-fatal pattern used for the Telegram notification in send-ai-reply.ts.
  if (isTemplate && campaign?.campaignFollowUpEnabled) {
    try {
      await tasks.trigger<AnyTask>("start-campaign-followup-sequence", {
        conversationId: payload.conversationId,
        leadId: payload.leadId,
        campaignId: campaign.id,
      });
    } catch (followUpErr) {
      logger.error("send-outbound: failed to start campaign follow-up sequence (non-fatal)", {
        campaignId: campaign.id,
        reason: followUpErr instanceof Error ? followUpErr.message : String(followUpErr),
      });
    }
  }

  return { sent: true, waMessageId: sendResult.waMessageId, messageId: message.id };
}

/**
 * Queue: concurrencyLimit 1. Callers MUST trigger this task with
 * `concurrencyKey: senderPhoneNumberId` — Trigger.dev then serializes all
 * sends sharing a sender number into one lane. Different sender numbers
 * still run in parallel. Retries are safe because Message.idempotencyKey
 * makes a duplicate send a no-op at the database layer, not just app logic.
 *
 * sendMessage()/sendTemplateMessage() still hard-throw unless
 * SENDING_ENABLED === "true", which is never set in a committed file — this
 * task cannot actually deliver a WhatsApp message until that's explicitly
 * enabled outside of source control.
 */
export const sendOutboundTask = task({
  id: "send-outbound",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: async (payload: SendOutboundPayload, { ctx }) => {
    logger.log("send-outbound received", { payload, ctx });
    return sendOutbound(payload);
  },
});
