import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeProofMedia, sendTelegramNotification } from "@/telegram/notify";

describe("sendTelegramNotification", () => {
  const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T13:37:00.000Z"));
  });

  afterEach(() => {
    if (originalBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalBotToken;
    if (originalChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = originalChatId;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it("posts to the correct Telegram Bot API URL with chat_id, and formats payment_confirmed with the verification-disclaimer Note", async () => {
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
      '💰 PAYMENT UPDATE\nLead: +213557633299\nMessage: "I\'ve made the payment."\n' +
        "Note: This is the client's claim only, not financial verification — please verify the payment yourself.\n" +
        "Time: 2026-08-23 13:37 UTC",
    );
  });

  it("formats a payment_intent notification correctly, with context when provided", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "payment_intent",
      leadPhoneE164: "+213557633299",
      triggeringMessageBody: "Send me the payment link",
      context: "negotiating",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toBe(
      '🚨 PAYMENT INTENT\nLead: +213557633299\nMessage: "Send me the payment link"\nContext: negotiating\nTime: 2026-08-23 13:37 UTC',
    );
  });

  it("formats a ready_to_start notification with Payment/Assets/Action lines, defaulting to 'Unknown' when not provided", async () => {
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
      '🚀 READY TO START\nLead: +213557633299\nMessage: "Yes, you can start."\n' +
        "Payment: Unknown\nAssets: Unknown\nAction: Start working on the project.\nTime: 2026-08-23 13:37 UTC",
    );
  });

  it("uses the provided paymentStatus and assetsStatus for ready_to_start when given", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "ready_to_start",
      leadPhoneE164: "+213557633299",
      triggeringMessageBody: "Here are the photos",
      paymentStatus: "Claimed by client (not yet manually verified)",
      assetsStatus: "Photos provided",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toContain("Payment: Claimed by client (not yet manually verified)");
    expect(body.text).toContain("Assets: Photos provided");
  });

  it("includes the lead's name when provided, formatted as 'Name (phone)'", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "ready_to_start",
      leadPhoneE164: "+213557633299",
      leadName: "Fatima",
      triggeringMessageBody: "Yes, you can start.",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toContain("Lead: Fatima (+213557633299)");
  });

  it("omits the Context line entirely when no context is provided", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "payment_intent",
      leadPhoneE164: "+1",
      triggeringMessageBody: "go",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).not.toContain("Context:");
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

  it("formats a payment_proof_received notification with the shortened label and Proof:/Action: lines", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "payment_proof_received",
      leadPhoneE164: "+213557633299",
      triggeringMessageBody: "here's the transfer",
      proofMediaDescription: "Image received",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toBe(
      '📎 PAYMENT PROOF\nLead: +213557633299\nMessage: "here\'s the transfer"\n' +
        "Proof: Image received\nAction: Please verify the payment manually.\nTime: 2026-08-23 13:37 UTC",
    );
  });

  it("falls back to 'File received' for payment_proof_received when no proofMediaDescription is given", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({
      milestone: "payment_proof_received",
      leadPhoneE164: "+1",
      triggeringMessageBody: "proof attached",
    });

    expect(fetchSpy.mock.calls[0]).toBeDefined();
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toContain("Proof: File received");
  });

  it("never adds Proof:/Note:/Payment:/Assets: lines to payment_intent", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({ milestone: "payment_intent", leadPhoneE164: "+1", triggeringMessageBody: "x" });

    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).not.toContain("Proof:");
    expect(body.text).not.toContain("Note:");
    expect(body.text).not.toContain("Payment:");
    expect(body.text).not.toContain("Assets:");
  });

  it("never adds Payment:/Assets:/Action: lines to payment_confirmed (only the Note)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "999";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendTelegramNotification({ milestone: "payment_confirmed", leadPhoneE164: "+1", triggeringMessageBody: "x" });

    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    expect(body.text).toContain("Note:");
    expect(body.text).not.toContain("Payment:");
    expect(body.text).not.toContain("Assets:");
    expect(body.text).not.toContain("Action:");
  });
});

describe("describeProofMedia", () => {
  it("describes an image", () => {
    expect(describeProofMedia("image")).toBe("Image received");
  });

  it("describes a PDF document by mime type", () => {
    expect(describeProofMedia("document", "application/pdf")).toBe("PDF received");
  });

  it("describes a non-PDF document with its filename when available", () => {
    expect(describeProofMedia("document", "application/msword", "receipt.docx")).toBe("Document received (receipt.docx)");
  });

  it("describes a non-PDF document with no filename generically", () => {
    expect(describeProofMedia("document", "application/msword")).toBe("Document received");
  });

  it("describes audio and video", () => {
    expect(describeProofMedia("audio")).toBe("Audio received");
    expect(describeProofMedia("video")).toBe("Video received");
  });

  it("falls back to 'File received' for an unrecognized or missing type", () => {
    expect(describeProofMedia("sticker")).toBe("File received");
    expect(describeProofMedia(null)).toBe("File received");
    expect(describeProofMedia(undefined)).toBe("File received");
  });
});
