import { afterEach, describe, expect, it, vi } from "vitest";

import { sendTelegramNotification } from "@/telegram/notify";

describe("sendTelegramNotification", () => {
  const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;

  afterEach(() => {
    if (originalBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalBotToken;
    if (originalChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = originalChatId;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when TELEGRAM_BOT_TOKEN is unset", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = "123";

    await expect(
      sendTelegramNotification({ milestone: "payment_confirmed", leadPhoneE164: "+15551234567", triggeringMessageBody: "paid" }),
    ).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("throws when TELEGRAM_CHAT_ID is unset", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    delete process.env.TELEGRAM_CHAT_ID;

    await expect(
      sendTelegramNotification({ milestone: "payment_confirmed", leadPhoneE164: "+15551234567", triggeringMessageBody: "paid" }),
    ).rejects.toThrow(/TELEGRAM_CHAT_ID/);
  });

  it("never calls fetch when config is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      sendTelegramNotification({ milestone: "ready_to_start", leadPhoneE164: "+1", triggeringMessageBody: "go" }),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the correct Telegram Bot API URL with chat_id and the expected message format", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "payment_confirmed",
      leadPhoneE164: "+213557633299",
      triggeringMessageBody: "I've made the payment.",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [url, options] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.telegram.org/botbot-token/sendMessage");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe("999");
    expect(body.text).toBe(
      '🔔 PAYMENT CONFIRMED\nLead: +213557633299\nMessage: "I\'ve made the payment."\nAction: Check the conversation and proceed.',
    );
  });

  it("formats a ready_to_start notification correctly", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "ready_to_start",
      leadPhoneE164: "+213557633299",
      triggeringMessageBody: "Yes, you can start.",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toBe(
      '🔔 READY TO START\nLead: +213557633299\nMessage: "Yes, you can start."\nAction: Take over / start the work.',
    );
  });

  it("throws with the response body when Telegram returns a non-ok response", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"ok":false,"description":"chat not found"}'),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      sendTelegramNotification({ milestone: "payment_confirmed", leadPhoneE164: "+1", triggeringMessageBody: "paid" }),
    ).rejects.toThrow(/chat not found/);
  });
});
