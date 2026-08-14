export interface SendTextMessageParams {
  to: string;
  body: string;
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Template send with optional body variable substitution. bodyParams maps
 * positionally to the template's {{1}}, {{2}}, ... placeholders — omit for
 * a template with no variables.
 */
export interface SendTemplateMessageParams {
  to: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  bodyParams?: string[];
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
