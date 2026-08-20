/**
 * Known "expected in test/dev mode" throw messages from sendOutbound() —
 * classified separately from genuine errors so the UI shows them as a
 * correct safety block (200) rather than a server failure (500). Shared by
 * every route that calls sendOutbound() directly.
 */
export const EXPECTED_TEST_MODE_BLOCKS = [
  "WHATSAPP_ACCESS_TOKEN is not set",
  "WHATSAPP_TEMPLATE_LANGUAGE is not set",
  "Outbound sending is disabled",
];

/**
 * Strips a thrown error down to a safe, human-readable message. Meta's own
 * `error.message` field (e.g. "Recipient phone number not in allowed list")
 * is the only thing ever extracted from a raw provider error body — never
 * the full JSON envelope, error codes, fbtrace_id, or anything else that
 * body might contain. Never touches tokens/phone-number-ids directly since
 * this only ever reads a thrown Error's message text, never request headers
 * or env vars.
 */
export function sanitizeProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw;

  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { message?: string } };
    const metaMessage = parsed.error?.message;
    if (typeof metaMessage === "string" && metaMessage) {
      return `Message failed to send: ${metaMessage}`;
    }
  } catch {
    // fall through
  }
  return "Message failed to send — the provider rejected the request.";
}

export interface ClassifiedSendError {
  outcome: "blocked_before_send" | "error";
  message: string;
  status: 200 | 500;
}

/**
 * Classifies a caught sendOutbound()/uploadMedia() error into what a route
 * should return: an expected test-mode block (200, raw message — it's not
 * provider output, it's our own guard message, safe to show as-is) or a
 * genuine failure (500, sanitized message).
 */
export function classifySendError(error: unknown): ClassifiedSendError {
  const raw = error instanceof Error ? error.message : String(error);
  const isExpectedBlock = EXPECTED_TEST_MODE_BLOCKS.some((known) => raw.includes(known));
  return isExpectedBlock
    ? { outcome: "blocked_before_send", message: raw, status: 200 }
    : { outcome: "error", message: sanitizeProviderError(error), status: 500 };
}
