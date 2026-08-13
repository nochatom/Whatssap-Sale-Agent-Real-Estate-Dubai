import { prisma } from "@/lib/prisma";

/**
 * Not the raw Conversation.status field (a free-form string, never actually
 * set anywhere beyond its "open" default). Derived instead from
 * lastInboundAt/lastOutboundAt — real, already-populated fields — so it
 * reflects something true: is the lead waiting on us, or did we already
 * respond.
 */
export type DerivedConversationStatus = "awaiting" | "responded" | "open";

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

    let status: DerivedConversationStatus = "open";
    if (c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt)) {
      status = "awaiting";
    } else if (c.lastOutboundAt) {
      status = "responded";
    }

    return {
      id: c.id,
      leadLabel: c.lead.name ?? c.lead.phoneE164,
      initials: initialsFor(c.lead.name, c.lead.phoneE164),
      message: last ? (last.body ?? `[${last.type}]`) : "No messages yet",
      lastActivity: c.updatedAt,
      status,
    };
  });
}
