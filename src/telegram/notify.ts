/**
 * Private, operator-only alert channel — entirely separate from the WhatsApp
 * send path (src/whatsapp/transport.ts). Never sends anything to the
 * customer; the only recipient is TELEGRAM_CHAT_ID, the operator's own chat.
 */

export type TelegramMilestone = "payment_intent" | "payment_confirmed" | "payment_proof_received" | "ready_to_start";

export interface TelegramNotificationParams {
  milestone: TelegramMilestone;
  leadPhoneE164: string;
  /** Lead.name — omitted from the message entirely when the lead has none. */
  leadName?: string;
  triggeringMessageBody: string;
  /** Short, optional context (e.g. sales stage) — only shown when provided. */
  context?: string;
  /** Only meaningful for payment_proof_received — see describeProofMedia(). */
  proofMediaDescription?: string;
}

const MILESTONE_LABELS: Record<TelegramMilestone, string> = {
  payment_intent: "💳 PAYMENT INTENT",
  payment_confirmed: "✅ PAYMENT CONFIRMED",
  payment_proof_received: "📎 PAYMENT PROOF RECEIVED",
  ready_to_start: "🚀 READY TO START",
};

function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Human-readable description of an attachment for the Proof: line — never
 * describes actual file CONTENT (there is no vision capability anywhere in
 * this codebase, see build-prompt.ts's mediaIndicator), only its type/name.
 */
export function describeProofMedia(
  type: string | null | undefined,
  mimeType?: string | null,
  filename?: string | null,
): string {
  if (type === "image") return "Image received";
  if (type === "document") {
    if (mimeType === "application/pdf") return "PDF received";
    return filename ? `Document received (${filename})` : "Document received";
  }
  if (type === "audio") return "Audio received";
  if (type === "video") return "Video received";
  return "File received";
}

function buildMessage(params: TelegramNotificationParams): string {
  const lines = [
    MILESTONE_LABELS[params.milestone],
    params.leadName ? `Lead: ${params.leadName} (${params.leadPhoneE164})` : `Lead: ${params.leadPhoneE164}`,
    `Message: "${params.triggeringMessageBody}"`,
  ];
  if (params.milestone === "payment_proof_received") {
    lines.push(`Proof: ${params.proofMediaDescription ?? "File received"}`);
    lines.push("Action: Please verify the payment manually.");
  }
  if (params.context) {
    lines.push(`Context: ${params.context}`);
  }
  lines.push(`Time: ${formatTimestamp(new Date())}`);
  return lines.join("\n");
}

/**
 * Sends one Telegram message via the Bot API's plain HTTPS sendMessage call —
 * same lightweight fetch()-based pattern as whatsapp/transport.ts, no SDK.
 * Throws on failure; the caller (trigger/send-telegram-notification.ts) is
 * responsible for making sure that failure never reaches the WhatsApp reply
 * path — this function itself has no awareness of WhatsApp at all.
 */
export async function sendTelegramNotification(params: TelegramNotificationParams): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set — required to send a Telegram notification");
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: buildMessage(params) }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errorBody}`);
  }
}
