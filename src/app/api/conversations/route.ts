import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { deriveConversationStatus } from "../../_lib/conversation-status";

/**
 * Read-only list for the Inbox's list pane — same query shape the
 * Conversations page already used server-side for its initial render,
 * exposed as an API so the pane can poll for new/updated conversations
 * without a full page reload. Nothing here writes anything.
 */
export async function GET() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      lead: { select: { phoneE164: true, name: true } },
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true, status: true } },
    },
  });

  const result = conversations.map((conv) => {
    const last = conv.messages[0];
    return {
      id: conv.id,
      lead: conv.lead,
      campaign: conv.campaign,
      status: deriveConversationStatus(conv.lastInboundAt, conv.lastOutboundAt),
      lastMessage: last ? (last.body ?? `[${last.type}]`) : null,
      lastMessageStatus: last?.status ?? null,
      lastInboundAt: conv.lastInboundAt,
      lastOutboundAt: conv.lastOutboundAt,
      updatedAt: conv.updatedAt,
      // Unread: there's a real inbound message the user hasn't opened this
      // conversation since (readAt unset, or set before that inbound arrived).
      isUnread: !!conv.lastInboundAt && (!conv.readAt || conv.readAt < conv.lastInboundAt),
    };
  });

  return NextResponse.json({ conversations: result });
}
