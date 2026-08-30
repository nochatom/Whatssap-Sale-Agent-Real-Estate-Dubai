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
    // id as a secondary sort key: a bulk CSV import can create hundreds of
    // conversations with the exact same updatedAt timestamp, and ORDER BY
    // updatedAt alone has no defined order among those ties — take(100) was
    // returning an arbitrary, unstable subset of them on every request, so
    // deleting the visible rows appeared to do nothing once a different
    // arbitrary 100 from the same tied group reappeared on refetch.
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 2000,
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

/**
 * Bulk-deletes conversations in a single atomic transaction, same FK-safe
 * child-to-parent order as the single-conversation DELETE in
 * /api/conversations/[id] (FollowUp, AiDecision, Message, then Conversation)
 * — just deleteMany over {in: ids} instead of one id at a time. Mirrors the
 * existing bulk-delete shape already used by /api/leads. Replaces the
 * Inbox's prior pattern of N sequential single-delete requests, which read
 * as "did nothing" once the (now-fixed) unstable take(100) pagination kept
 * refilling the list with a different arbitrary subset after each request.
 */
export async function DELETE(request: NextRequest) {
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "ids (JSON body array) is required" }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((v) => typeof v === "string")) {
    return NextResponse.json({ error: "ids must be a non-empty array of strings" }, { status: 400 });
  }
  const ids = body.ids;

  await prisma.$transaction([
    prisma.followUp.deleteMany({ where: { conversationId: { in: ids } } }),
    prisma.aiDecision.deleteMany({ where: { conversationId: { in: ids } } }),
    prisma.message.deleteMany({ where: { conversationId: { in: ids } } }),
    prisma.conversation.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return NextResponse.json({ deleted: true, count: ids.length });
}
