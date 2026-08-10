interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppWebhookValue {
  messages?: WhatsAppWebhookMessage[];
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
}

/**
 * Pulls the first inbound message out of a Meta WhatsApp Cloud API webhook
 * payload. Returns null for status-update payloads or any shape without a
 * message (defensive against Meta's payload variants — never throws on a
 * malformed or partial body).
 */
export function extractInboundMessage(payload: WhatsAppWebhookPayload): ParsedInboundMessage | null {
  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;

  return {
    from: message.from,
    waMessageId: message.id,
    timestamp: message.timestamp,
    type: message.type,
    text: message.type === "text" ? message.text?.body : undefined,
  };
}
