import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildInboundIdempotencyKey } from "@/whatsapp/idempotency";
import { verifyWebhookSignature, verifyWebhookSubscription } from "@/whatsapp/transport";
import { extractInboundMessage, extractStatusUpdates, type WhatsAppWebhookPayload } from "@/whatsapp/webhook-payload";
import type { MessageStatus } from "@prisma/client";
import { normalizePhoneToE164 } from "@/csv/phone";
import { handleInboundTask } from "@trigger/handle-inbound";

export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const challenge = verifyWebhookSubscription(request.nextUrl.searchParams, verifyToken);
  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, { status: 200 });
}

// Meta's lowercase status string -> our MessageStatus enum. Unrecognized
// values (Meta occasionally adds new ones) are skipped, never guessed.
const META_STATUS_MAP: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

// Guards against out-of-order webhook delivery (a real, documented Meta
// behavior) regressing a message from e.g. READ back down to DELIVERED.
const STATUS_RANK: Partial<Record<MessageStatus, number>> = {
  QUEUED: 0,
  SENT: 1,
  FAILED: 1,
  DELIVERED: 2,
  READ: 3,
};

async function applyStatusUpdates(payload: WhatsAppWebhookPayload): Promise<void> {
  const updates = extractStatusUpdates(payload);
  for (const update of updates) {
    const nextStatus = META_STATUS_MAP[update.status];
    if (!nextStatus) continue; // unrecognized Meta status — don't invent one

    const message = await prisma.message.findUnique({ where: { waMessageId: update.waMessageId } });
    if (!message) continue; // status for a message we don't have (e.g. pre-dates this deployment)

    const currentRank = STATUS_RANK[message.status] ?? -1;
    const nextRank = STATUS_RANK[nextStatus] ?? -1;
    if (nextRank <= currentRank) continue;

    await prisma.message.update({ where: { id: message.id }, data: { status: nextStatus } });
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = request.headers.get("x-hub-signature-256");

  if (!appSecret || !verifyWebhookSignature(rawBody, signature, appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const inbound = extractInboundMessage(payload);
  if (!inbound) {
    // No inbound message in this payload — could be a delivery/read/failed
    // status update instead, so check for that before acking with nothing done.
    await applyStatusUpdates(payload);
    return new NextResponse("OK", { status: 200 });
  }

  const rawFrom = inbound.from.startsWith("+") ? inbound.from : `+${inbound.from}`;
  const normalized = normalizePhoneToE164(rawFrom);
  const phoneE164 = normalized.e164 ?? rawFrom;

  const lead = await prisma.lead.upsert({
    where: { phoneE164 },
    update: {},
    create: { phoneE164 },
  });

  let conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { leadId: lead.id, senderPhoneNumberId: inbound.receivingPhoneNumberId },
    });
  }

  const idempotencyKey = buildInboundIdempotencyKey(inbound.waMessageId);
  const message = await prisma.message.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      conversationId: conversation.id,
      direction: "INBOUND",
      waMessageId: inbound.waMessageId,
      idempotencyKey,
      type: inbound.type,
      body: inbound.text ?? null,
      mediaId: inbound.mediaId ?? null,
      mimeType: inbound.mimeType ?? null,
      status: "RECEIVED",
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    // senderPhoneNumberId: undefined leaves an existing value untouched if
    // this particular webhook payload happens to omit metadata — it's only
    // ever set, never cleared, by an inbound message.
    data: { lastInboundAt: new Date(), senderPhoneNumberId: inbound.receivingPhoneNumberId },
  });

  await handleInboundTask.trigger(
    {
      conversationId: conversation.id,
      messageId: message.id,
      waMessageId: inbound.waMessageId,
    },
    { concurrencyKey: conversation.id },
  );

  return new NextResponse("OK", { status: 200 });
}
