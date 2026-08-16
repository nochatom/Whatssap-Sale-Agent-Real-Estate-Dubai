/**
 * Deterministic idempotency keys, one scheme per send origin — see Message.idempotencyKey.
 *
 * - Campaign opener: collision-proof per (campaign, lead). This is what prevents the
 *   opener from ever being double-sent to the same lead.
 * - AI reply: keyed off the inbound message that triggered it, so retrying the same
 *   inbound webhook delivery can't produce two replies.
 * - Follow-up: keyed off the FollowUp row itself, so a retried follow-up send can't
 *   double-send.
 *
 * All three are distinct key spaces on purpose — a conversation sends more than one
 * outbound message (opener, reply, follow-ups), and only the opener needs to be
 * unique per lead; the others need to be unique per triggering event instead.
 */

export function buildInboundIdempotencyKey(waMessageId: string): string {
  return `in:${waMessageId}`;
}

export function buildCampaignOpenerIdempotencyKey(campaignId: string, leadId: string): string {
  return `out:campaign:${campaignId}:${leadId}`;
}

export function buildReplyIdempotencyKey(
  conversationId: string,
  inboundWaMessageId: string,
): string {
  return `out:reply:${conversationId}:${inboundWaMessageId}`;
}

export function buildFollowUpIdempotencyKey(followUpId: string): string {
  return `out:followup:${followUpId}`;
}

/**
 * Manual reply from the Inbox — unlike the AI reply (keyed off the inbound
 * message that triggered it) there's no triggering event to key off, so
 * this uses a fresh id per send. Real double-submit protection is the
 * client disabling the Send button while a request is in flight, not this
 * key — this only guarantees Message.idempotencyKey's uniqueness constraint
 * is satisfiable.
 */
export function buildManualReplyIdempotencyKey(conversationId: string): string {
  return `out:manual:${conversationId}:${crypto.randomUUID()}`;
}
