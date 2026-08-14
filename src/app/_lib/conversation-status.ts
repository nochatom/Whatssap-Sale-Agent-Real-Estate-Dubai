/**
 * Pure, client-safe status logic — split out of recent-conversations.ts
 * (which imports the Prisma client) so the Inbox's client component can use
 * the same derive/display logic without pulling a server-only module into
 * the browser bundle. recent-conversations.ts re-exports these for the
 * existing server-side call sites, so nothing else needs to change.
 */

export type DerivedConversationStatus = "awaiting" | "responded" | "open";

/**
 * Not the raw Conversation.status field (a free-form string, never actually
 * set anywhere beyond its "open" default). Derived instead from
 * lastInboundAt/lastOutboundAt — real, already-populated fields — so it
 * reflects something true: is the lead waiting on us, or did we already
 * respond.
 */
export function deriveConversationStatus(lastInboundAt: Date | null, lastOutboundAt: Date | null): DerivedConversationStatus {
  if (lastInboundAt && (!lastOutboundAt || lastInboundAt > lastOutboundAt)) return "awaiting";
  if (lastOutboundAt) return "responded";
  return "open";
}

/** Shared label/tone mapping — one source of truth for every surface that shows conversation status. */
export const CONVERSATION_STATUS_DISPLAY: Record<DerivedConversationStatus, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  awaiting: { tone: "warn", label: "Awaiting reply" },
  responded: { tone: "ok", label: "Responded" },
  open: { tone: "neutral", label: "Open" },
};
