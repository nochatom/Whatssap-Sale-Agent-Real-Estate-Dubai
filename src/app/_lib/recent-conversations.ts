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

export function deriveConversationStatus(lastInboundAt: Date | null, lastOutboundAt: Date | null): DerivedConversationStatus {
  if (lastInboundAt && (!lastOutboundAt || lastInboundAt > lastOutboundAt)) return "awaiting";
  if (lastOutboundAt) return "responded";
  return "open";
}

/** Shared label/tone mapping — used by both the Dashboard widget and the Conversations page, one source of truth. */
export const CONVERSATION_STATUS_DISPLAY: Record<DerivedConversationStatus, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  awaiting: { tone: "warn", label: "Awaiting reply" },
  responded: { tone: "ok", label: "Responded" },
  open: { tone: "neutral", label: "Open" },
};

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
