import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { deriveConversationStatus } from "../../_lib/conversation-status";

function isUnread(conv: { lastInboundAt: Date | null; readAt: Date | null }): boolean {
  // There's a real inbound message the user hasn't opened this conversation
  // since (readAt unset, or set before that inbound arrived).
  return !!conv.lastInboundAt && (!conv.readAt || conv.readAt < conv.lastInboundAt);
}

/**
 * Read-only list for the Inbox's list pane — same query shape the
 * Conversations page already used server-side for its initial render,
 * exposed as an API so the pane can poll for new/updated conversations
 * without a full page reload. Nothing here writes anything.
 *
 * ?archived=true switches to the Archived view (only archivedAt-set rows);
 * default (omitted/false) is the normal inbox (archivedAt null only) — the
 * same query shape either way, just the one extra where clause.
 */
export async function GET(request: NextRequest) {
  const showArchived = request.nextUrl.searchParams.get("archived") === "true";

  const conversations = await prisma.conversation.findMany({
    where: showArchived ? { archivedAt: { not: null } } : { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      lead: { select: { phoneE164: true, name: true } },
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true, status: true } },
    },
  });

  const result = conversations.map((conv) => ({
    id: conv.id,
    lead: conv.lead,
    campaign: conv.campaign,
    status: deriveConversationStatus(conv.lastInboundAt, conv.lastOutboundAt),
    lastMessage: conv.messages[0] ? (conv.messages[0].body ?? `[${conv.messages[0].type}]`) : null,
    lastMessageStatus: conv.messages[0]?.status ?? null,
    lastInboundAt: conv.lastInboundAt,
    lastOutboundAt: conv.lastOutboundAt,
    updatedAt: conv.updatedAt,
    isUnread: isUnread(conv),
    archivedAt: conv.archivedAt,
  }));

  // Aggregate unread count is always across the active (non-archived) inbox,
  // regardless of which view was requested — an archived view has its own
  // read/unread badges per row, but "how many unread do I have" means the
  // inbox, not whatever list happens to be open.
  const unreadCount = showArchived
    ? await prisma.conversation
        .findMany({ where: { archivedAt: null }, select: { lastInboundAt: true, readAt: true } })
        .then((rows) => rows.filter(isUnread).length)
    : result.filter((r) => r.isUnread).length;

  return NextResponse.json({ conversations: result, unreadCount });
}
