import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { deriveConversationStatus } from "../../../../_lib/conversation-status";

/**
 * Read-only single-conversation detail + full message history for the
 * Inbox's thread pane — and for polling to pick up new inbound messages as
 * the existing webhook -> handle-inbound pipeline persists them. No writes,
 * no new send path; this only reads what's already stored.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      lead: { select: { phoneE164: true, name: true } },
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      lead: conversation.lead,
      campaign: conversation.campaign,
      status: deriveConversationStatus(conversation.lastInboundAt, conversation.lastOutboundAt),
      lastInboundAt: conversation.lastInboundAt,
      lastOutboundAt: conversation.lastOutboundAt,
      readAt: conversation.readAt,
    },
    messages: conversation.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      type: m.type,
      templateName: m.templateName,
      mediaId: m.mediaId,
      mimeType: m.mimeType,
      filename: m.filename,
      replyToMessageId: m.replyToMessageId,
      status: m.status,
      createdAt: m.createdAt,
    })),
  });
}
