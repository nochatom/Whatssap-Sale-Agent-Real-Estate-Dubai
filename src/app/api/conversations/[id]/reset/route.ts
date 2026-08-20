import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Starts a fresh conversation context for the same lead: archives the
 * current conversation (existing archivedAt mechanism — hides it from the
 * active Inbox, never touches its Messages or any other row) and creates a
 * brand-new, empty Conversation for the same lead. senderPhoneNumberId is
 * carried over (a routing detail — which WhatsApp number owns this thread —
 * not conversation "context"); campaignId is deliberately NOT carried over,
 * since a reset is meant to be a genuinely fresh start, not a continuation
 * of the old campaign link.
 *
 * The webhook always attaches a new inbound message to the most recently
 * created Conversation for a lead (see src/app/api/webhooks/whatsapp/route.ts,
 * `orderBy: { createdAt: "desc" }`) — so once this returns, the next real
 * inbound message lands on the new conversation automatically, with no
 * other pipeline code needing to change. The AI's history (send-ai-reply.ts)
 * is always scoped to one conversationId, so it can only ever see messages
 * belonging to the new, empty conversation from that point on.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const oldConversation = await prisma.conversation.findUnique({ where: { id } });
  if (!oldConversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const [, newConversation] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id },
      // Preserve the original archive time if this was already archived —
      // only ever sets it forward from null, never overwrites history.
      data: { archivedAt: oldConversation.archivedAt ?? new Date() },
    }),
    prisma.conversation.create({
      data: {
        leadId: oldConversation.leadId,
        senderPhoneNumberId: oldConversation.senderPhoneNumberId,
      },
    }),
  ]);

  return NextResponse.json({
    oldConversationId: id,
    newConversation: { id: newConversation.id },
  });
}
