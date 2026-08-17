import { logger, task } from "@trigger.dev/sdk/v3";

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
}

export type SendOutboundResult =
  | { sent: false; blockedBy: ComplianceFailure }
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

  const [lead, campaign, conversation] = await Promise.all([
    prisma.lead.findUniqueOrThrow({ where: { id: payload.leadId } }),
    payload.campaignId
      ? prisma.campaign.findUniqueOrThrow({ where: { id: payload.campaignId } })
      : Promise.resolve(null),
    prisma.conversation.findUniqueOrThrow({ where: { id: payload.conversationId } }),
  ]);

  const gate = await runComplianceGate({
    phoneE164: lead.phoneE164,
    lead,
    campaign,
    conversation,
    idempotencyKey: payload.idempotencyKey,
    isTemplate,
  });

  if (!gate.passed) {
    logger.log("send-outbound: blocked by compliance gate", {
      conversationId: payload.conversationId,
      failedCheck: gate.failedCheck,
    });
    return { sent: false, blockedBy: gate.failedCheck as ComplianceFailure };
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

  const message = await prisma.message.create({
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
  });

  await prisma.conversation.update({
    where: { id: payload.conversationId },
    data: { lastOutboundAt: new Date() },
  });

  logger.log("send-outbound: sent", {
    messageId: message.id,
    waMessageId: sendResult.waMessageId,
    isTemplate,
  });

  return { sent: true, waMessageId: sendResult.waMessageId, messageId: message.id };
}

/**
 * Queue: concurrencyLimit 1. Callers MUST trigger this task with
 * `concurrencyKey: senderPhoneNumberId` — Trigger.dev then serializes all
 * sends sharing a sender number into one lane, which is what makes the
 * daily-budget read-then-send in src/compliance/checks.ts#checkDailyBudget
 * effectively atomic per sender. Different sender numbers still run in
 * parallel. Retries are safe because Message.idempotencyKey makes a
 * duplicate send a no-op at the database layer, not just app logic.
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
