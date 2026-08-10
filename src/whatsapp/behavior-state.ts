import type { WhatsAppBehaviorState } from "@/skill/types";

/**
 * Only state A (a written reply) is reachable from the current webhook path.
 * Reaction events (state D) can't be classified yet — the Message model has
 * no field for which message was reacted to or with what emoji, and adding
 * one is a schema change that needs explicit approval first. Read-receipt/
 * silence states (B, C, F outside the follow-up path) need a separate
 * webhook path (status updates) that doesn't exist yet. Anything else
 * returns null rather than guessing an interpretation the Skill was never
 * asked to handle.
 *
 * Shared by handle-inbound.ts and send-ai-reply.ts — kept in its own module
 * so neither has to import the other (they'd otherwise form a cycle: handle-
 * inbound schedules send-ai-reply, and both need this same classifier).
 */
export function classifyBehaviorState(message: {
  type: string;
  body: string | null;
}): WhatsAppBehaviorState | null {
  if (message.type === "text" && message.body) return "A";
  return null;
}
