import { prisma } from "@/lib/prisma";
import { space, colors } from "../_lib/ui-tokens";
import { deriveConversationStatus } from "../_lib/conversation-status";
import InboxClient, { type ConversationSummary } from "./InboxClient";

// Queries the DB on every load — must render per-request, not be statically
// prerendered at build time, when no DATABASE_URL is available.
export const dynamic = "force-dynamic";

/**
 * Server component: does the initial fetch (same query shape the old
 * read-only table used) so the page has real data on first paint, then
 * hands off to InboxClient for the interactive two-pane inbox (list +
 * thread) and its own polling via /api/conversations and
 * /api/conversations/[id]/messages. This is the same "Conversations" route
 * and sidebar entry as before — the Inbox, not a duplicate section.
 */
export default async function ConversationsPage() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      lead: { select: { phoneE164: true, name: true } },
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true } },
    },
  });

  const initialConversations: ConversationSummary[] = conversations.map((conv) => {
    const last = conv.messages[0];
    return {
      id: conv.id,
      lead: conv.lead,
      campaign: conv.campaign,
      status: deriveConversationStatus(conv.lastInboundAt, conv.lastOutboundAt),
      lastMessage: last ? (last.body ?? `[${last.type}]`) : null,
      lastInboundAt: conv.lastInboundAt ? conv.lastInboundAt.toISOString() : null,
      lastOutboundAt: conv.lastOutboundAt ? conv.lastOutboundAt.toISOString() : null,
      updatedAt: conv.updatedAt.toISOString(),
    };
  });

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 ${space.xxs}px` }}>Conversations</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.sm}px` }}>
        Read the real WhatsApp conversation history — updates automatically as new messages arrive.
      </p>

      <InboxClient initialConversations={initialConversations} />
    </main>
  );
}
