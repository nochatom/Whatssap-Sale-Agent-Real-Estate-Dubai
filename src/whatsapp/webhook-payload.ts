interface WhatsAppWebhookMedia {
  id: string;
  mime_type?: string;
}

interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WhatsAppWebhookMedia;
  document?: WhatsAppWebhookMedia;
  audio?: WhatsAppWebhookMedia;
  video?: WhatsAppWebhookMedia;
  sticker?: WhatsAppWebhookMedia;
}

interface WhatsAppWebhookStatus {
  id: string;
  status: string;
  timestamp: string;
}

interface WhatsAppWebhookMetadata {
  phone_number_id?: string;
}

interface WhatsAppWebhookValue {
  metadata?: WhatsAppWebhookMetadata;
  messages?: WhatsAppWebhookMessage[];
  statuses?: WhatsAppWebhookStatus[];
}

interface WhatsAppWebhookChange {
  value?: WhatsAppWebhookValue;
}

interface WhatsAppWebhookEntry {
  changes?: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

export interface ParsedInboundMessage {
  from: string;
  waMessageId: string;
  timestamp: string;
  type: string;
  text?: string;
  mediaId?: string;
  mimeType?: string;
  /**
   * The receiving WhatsApp Business phone_number_id from the webhook's
   * metadata block — which of the business's numbers this message arrived
   * on. Used to populate Conversation.senderPhoneNumberId so a reply can be
   * sent from the correct number even when there's no Campaign to source it
   * from (organic inbound).
   */
  receivingPhoneNumberId?: string;
}

export interface ParsedStatusUpdate {
  waMessageId: string;
  /** Meta's raw status string ("sent" | "delivered" | "read" | "failed", lowercase) — mapped to MessageStatus by the caller, not guessed here. */
  status: string;
  timestamp: string;
}

const MEDIA_FIELD_BY_TYPE: Record<string, "image" | "document" | "audio" | "video" | "sticker"> = {
  image: "image",
  document: "document",
  audio: "audio",
  video: "video",
  sticker: "sticker",
};

/**
 * Pulls the first inbound message out of a Meta WhatsApp Cloud API webhook
 * payload. Returns null for status-update-only payloads or any shape
 * without a message (defensive against Meta's payload variants — never
 * throws on a malformed or partial body).
 */
export function extractInboundMessage(payload: WhatsAppWebhookPayload): ParsedInboundMessage | null {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return null;

  const mediaField = MEDIA_FIELD_BY_TYPE[message.type];
  const media = mediaField ? message[mediaField] : undefined;

  return {
    from: message.from,
    waMessageId: message.id,
    timestamp: message.timestamp,
    type: message.type,
    text: message.type === "text" ? message.text?.body : undefined,
    mediaId: media?.id,
    mimeType: media?.mime_type,
    receivingPhoneNumberId: value?.metadata?.phone_number_id,
  };
}

/**
 * Pulls delivery/read/failed status updates out of the same webhook shape
 * (Meta sends these in a separate "statuses" array alongside — never mixed
 * with — "messages", so a single payload is one or the other, not both).
 * Returns an empty array rather than null when there are none, since a
 * payload can carry more than one status update at a time.
 */
export function extractStatusUpdates(payload: WhatsAppWebhookPayload): ParsedStatusUpdate[] {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const statuses = value?.statuses;
  if (!statuses || statuses.length === 0) return [];

  return statuses.map((s) => ({
    waMessageId: s.id,
    status: s.status,
    timestamp: s.timestamp,
  }));
}
