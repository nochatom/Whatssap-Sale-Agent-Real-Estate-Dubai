export interface SendTextMessageParams {
  to: string;
  body: string;
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Minimum viable template send: name + language only, no component/variable
 * substitution. If an approved template needs variables, that's not
 * supported yet — see the Phase 2 report.
 */
export interface SendTemplateMessageParams {
  to: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
}

export interface SendMessageResult {
  waMessageId: string;
}

export interface InboundWebhookMessage {
  waMessageId: string;
  from: string;
  timestamp: string;
  type: string;
  text?: string;
}
