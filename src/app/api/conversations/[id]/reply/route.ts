import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildManualReplyIdempotencyKey } from "@/whatsapp/idempotency";
import { classifySendError, sanitizeProviderError } from "@/whatsapp/send-error";
import { uploadMedia } from "@/whatsapp/transport";
import { MEDIA_LIMITS, mediaKindForMimeType } from "@/whatsapp/types";
import { sendOutbound, type SendOutboundMedia } from "@trigger/send-outbound";

/**
 * Reply from the Inbox composer — text, or media (image/video/document/
 * audio) with an optional caption, optionally quoting another message.
 * Always multipart/form-data now (even text-only), one shape for the whole
 * composer. Calls the existing, unchanged sendOutbound() — the same
 * centralized, compliance-gated send path every other send in this app
 * already goes through. Media bytes go to Meta's own /media upload endpoint
 * (uploadMedia()) before sendOutbound ever runs; nothing here invents a
 * parallel send mechanism or a second storage system.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const bodyField = form.get("body");
  const clientMessageId = form.get("clientMessageId");
  const replyToMessageIdField = form.get("replyToMessageId");
  const file = form.get("file");

  if (typeof clientMessageId !== "string" || !clientMessageId.trim()) {
    return NextResponse.json({ error: "clientMessageId is required" }, { status: 400 });
  }
  const caption = typeof bodyField === "string" && bodyField.trim() ? bodyField.trim() : undefined;
  const hasFile = file instanceof File && file.size > 0;
  if (!caption && !hasFile) {
    return NextResponse.json({ error: "body or file is required" }, { status: 400 });
  }
  const replyToMessageId =
    typeof replyToMessageIdField === "string" && replyToMessageIdField.trim() ? replyToMessageIdField.trim() : undefined;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { campaign: { select: { id: true, senderPhoneNumberId: true } } },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const senderPhoneNumberId = conversation.campaign?.senderPhoneNumberId ?? conversation.senderPhoneNumberId;
  if (!senderPhoneNumberId) {
    return NextResponse.json(
      { error: "No sender phone number known for this conversation — it has no campaign and no inbound message has set one yet" },
      { status: 409 },
    );
  }

  let media: SendOutboundMedia | undefined;
  if (hasFile) {
    const kind = mediaKindForMimeType(file.type);
    if (!kind) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type || "unknown"}` }, { status: 400 });
    }
    const limits = MEDIA_LIMITS[kind];
    if (file.size > limits.maxBytes) {
      return NextResponse.json(
        { error: `File too large — ${kind} messages are limited to ${Math.round(limits.maxBytes / (1024 * 1024))}MB` },
        { status: 400 },
      );
    }

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ outcome: "blocked_before_send", message: "WHATSAPP_ACCESS_TOKEN is not set" }, { status: 200 });
    }

    try {
      const uploaded = await uploadMedia({ phoneNumberId: senderPhoneNumberId, accessToken, file, filename: file.name });
      media = { mediaId: uploaded.mediaId, kind, mimeType: file.type, filename: kind === "document" ? file.name : undefined };
    } catch (error) {
      return NextResponse.json({ outcome: "error", message: sanitizeProviderError(error) }, { status: 500 });
    }
  }

  try {
    const result = await sendOutbound({
      conversationId: conversation.id,
      campaignId: conversation.campaign?.id,
      leadId: conversation.leadId,
      senderPhoneNumberId,
      idempotencyKey: buildManualReplyIdempotencyKey(conversation.id, clientMessageId),
      body: caption,
      isTemplate: false,
      media,
      replyToMessageId,
    });
    return NextResponse.json({ outcome: "returned", result });
  } catch (error) {
    const classified = classifySendError(error);
    return NextResponse.json(
      { outcome: classified.outcome, message: classified.message },
      { status: classified.status },
    );
  }
}
