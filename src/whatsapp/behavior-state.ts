import type { WhatsAppBehaviorState } from "@/skill/types";

// Media types the inbound webhook already parses correctly (mediaId/mimeType/
// filename populated, see src/whatsapp/webhook-payload.ts) — body is null for
// all of these by design (no vision capability, see build-prompt.ts's
// mediaIndicator), so classification here can't depend on body content.
const MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

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
 * A media message (image/document/audio/video/sticker) also classifies as A —
 * it's active client engagement, not silence, even though its body is null.
 * This matters concretely for payment_proof_received: a client sending a
 * bare screenshot with no caption text must still reach the Skill, or that
 * milestone could never fire for the single most likely real trigger.
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
  if (MEDIA_TYPES.has(message.type)) return "A";
  return null;
}
