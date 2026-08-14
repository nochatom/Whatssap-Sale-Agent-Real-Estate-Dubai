import { prisma } from "@/lib/prisma";

import { deriveConversationStatus, CONVERSATION_STATUS_DISPLAY, type DerivedConversationStatus } from "./conversation-status";

export { deriveConversationStatus, CONVERSATION_STATUS_DISPLAY };
export type { DerivedConversationStatus };

export interface RecentConversation {
  id: string;
  leadLabel: string;
  initials: string;
  message: string;
  lastActivity: Date;
  status: DerivedConversationStatus;
}

function initialsFor(name: string | null, phone: string): string {
  if (name) {
    const initials = name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("");
    if (initials) return initials;
  }
  return phone.slice(-2);
}

export async function getRecentConversations(limit = 6): Promise<RecentConversation[]> {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      updatedAt: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      lead: { select: { name: true, phoneE164: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true } },
    },
  });

  return conversations.map((c) => {
    const last = c.messages[0];

    return {
      id: c.id,
      leadLabel: c.lead.name ?? c.lead.phoneE164,
      initials: initialsFor(c.lead.name, c.lead.phoneE164),
      message: last ? (last.body ?? `[${last.type}]`) : "No messages yet",
      lastActivity: c.updatedAt,
      status: deriveConversationStatus(c.lastInboundAt, c.lastOutboundAt),
    };
  });
}
