import { logger, task } from "@trigger.dev/sdk/v3";

import { sendTelegramNotification, type TelegramMilestone } from "@/telegram/notify";

export interface SendTelegramNotificationPayload {
  milestone: TelegramMilestone;
  leadPhoneE164: string;
  triggeringMessageBody: string;
}

/**
 * Queue: entirely independent of every WhatsApp-sending queue
 * (send-outbound, send-ai-reply) — no shared concurrencyKey, no shared
 * concurrencyLimit. A slow or failing Telegram API can only ever delay other
 * Telegram notifications, never a customer's WhatsApp reply.
 *
 * retry: 2 attempts (not the usual 3) — this is a best-effort internal alert,
 * not a customer-facing send, so it doesn't warrant the same retry budget as
 * an actual WhatsApp message.
 */
export const sendTelegramNotificationTask = task({
  id: "send-telegram-notification",
  queue: { concurrencyLimit: 5 },
  retry: { maxAttempts: 2 },
  run: async (payload: SendTelegramNotificationPayload, { ctx }) => {
    logger.log("send-telegram-notification received", { payload, ctx });
    await sendTelegramNotification(payload);
  },
});
