import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessage, sendTemplateMessage } from "@/whatsapp/transport";

describe("sendMessage", () => {
  const originalSendingEnabled = process.env.SENDING_ENABLED;

  afterEach(() => {
    process.env.SENDING_ENABLED = originalSendingEnabled;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when SENDING_ENABLED is unset", async () => {
    delete process.env.SENDING_ENABLED;

    await expect(
      sendMessage({
        to: "+15551234567",
        body: "hello",
        phoneNumberId: "123",
        accessToken: "token",
      }),
    ).rejects.toThrow(/SENDING_ENABLED/);
  });

  it("throws when SENDING_ENABLED is 'false'", async () => {
    process.env.SENDING_ENABLED = "false";

    await expect(
      sendMessage({
        to: "+15551234567",
        body: "hello",
        phoneNumberId: "123",
        accessToken: "token",
      }),
    ).rejects.toThrow(/SENDING_ENABLED/);
  });

  it("never calls fetch when sending is disabled", async () => {
    delete process.env.SENDING_ENABLED;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      sendMessage({ to: "+1", body: "x", phoneNumberId: "1", accessToken: "t" }),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("with SENDING_ENABLED=true", () => {
    beforeEach(() => {
      process.env.SENDING_ENABLED = "true";
    });

    it("calls the Graph API with the expected request shape and returns the message id", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: "wamid.ABC123" }] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await sendMessage({
        to: "+15551234567",
        body: "hello there",
        phoneNumberId: "999888777",
        accessToken: "test-token",
      });

      expect(result).toEqual({ waMessageId: "wamid.ABC123" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://graph.facebook.com/v21.0/999888777/messages");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer test-token");

      const body = JSON.parse(init.body);
      expect(body).toEqual({
        messaging_product: "whatsapp",
        to: "+15551234567",
        type: "text",
        text: { body: "hello there" },
      });
    });

    it("throws with the response body when the Graph API returns a non-ok status", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid recipient"}',
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        sendMessage({ to: "+1", body: "x", phoneNumberId: "1", accessToken: "t" }),
      ).rejects.toThrow(/invalid recipient/);
    });

    it("throws when the Graph API response is missing a message id", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        sendMessage({ to: "+1", body: "x", phoneNumberId: "1", accessToken: "t" }),
      ).rejects.toThrow(/missing message id/);
    });
  });
});

describe("sendTemplateMessage", () => {
  const originalSendingEnabled = process.env.SENDING_ENABLED;

  afterEach(() => {
    process.env.SENDING_ENABLED = originalSendingEnabled;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when SENDING_ENABLED is unset, and never calls fetch", async () => {
    delete process.env.SENDING_ENABLED;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      sendTemplateMessage({
        to: "+15551234567",
        phoneNumberId: "1",
        accessToken: "t",
        templateName: "property_video_intro",
        templateLanguage: "en_US",
      }),
    ).rejects.toThrow(/SENDING_ENABLED/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a template payload with name and language, no free-text body", async () => {
    process.env.SENDING_ENABLED = "true";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.TPL1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTemplateMessage({
      to: "+15551234567",
      phoneNumberId: "999888777",
      accessToken: "test-token",
      templateName: "property_video_intro",
      templateLanguage: "en_US",
    });

    expect(result).toEqual({ waMessageId: "wamid.TPL1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/999888777/messages");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "+15551234567",
      type: "template",
      template: { name: "property_video_intro", language: { code: "en_US" } },
    });
  });

  it("throws with the response body when the Graph API rejects the template", async () => {
    process.env.SENDING_ENABLED = "true";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"template not approved"}',
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTemplateMessage({
        to: "+1",
        phoneNumberId: "1",
        accessToken: "t",
        templateName: "x",
        templateLanguage: "en_US",
      }),
    ).rejects.toThrow(/template not approved/);
  });
});
