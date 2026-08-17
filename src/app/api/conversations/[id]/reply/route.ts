import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildManualReplyIdempotencyKey } from "@/whatsapp/idempotency";
import { uploadMedia } from "@/whatsapp/transport";
import { MEDIA_LIMITS, mediaKindForMimeType } from "@/whatsapp/types";
import { sendOutbound, type SendOutboundMedia } from "@trigger/send-outbound";

// Same list as /api/leads/send — known "expected in test/dev mode" throw
// messages, classified separately from genuine errors so the UI shows them
// as a correct safety block (200) rather than a server failure (500).
const EXPECTED_TEST_MODE_BLOCKS = [
  "WHATSAPP_ACCESS_TOKEN is not set",
  "WHATSAPP_TEMPLATE_LANGUAGE is not set",
  "Outbound sending is disabled",
];

/**
 * Strips a thrown error down to a safe, human-readable message. Meta's own
 * `error.message` field (e.g. "Recipient phone number not in allowed list")
 * is the only thing ever extracted from a raw provider error body — never
 * the full JSON envelope, error codes, fbtrace_id, or anything else that
 * body might contain. Never touches tokens/phone-number-ids directly since
 * this only ever reads a thrown Error's message text, never request headers
 * or env vars.
 */
function sanitizeProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw;

  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { message?: string } };
    const metaMessage = parsed.error?.message;
    if (typeof metaMessage === "string" && metaMessage) {
      return `Message failed to send: ${metaMessage}`;
    }
  } catch {
    // fall through
  }
  return "Message failed to send — the provider rejected the request.";
}

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
    const message = error instanceof Error ? error.message : String(error);
    const isExpectedBlock = EXPECTED_TEST_MODE_BLOCKS.some((known) => message.includes(known));
    return NextResponse.json(
      { outcome: isExpectedBlock ? "blocked_before_send" : "error", message: isExpectedBlock ? message : sanitizeProviderError(error) },
      { status: isExpectedBlock ? 200 : 500 },
    );
  }
}
