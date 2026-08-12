import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;

const leadUpsert = vi.fn();
const conversationFindFirst = vi.fn();
const conversationCreate = vi.fn();
const conversationUpdate = vi.fn();
const messageUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { upsert: (...args: unknown[]) => leadUpsert(...args) },
    conversation: {
      findFirst: (...args: unknown[]) => conversationFindFirst(...args),
      create: (...args: unknown[]) => conversationCreate(...args),
      update: (...args: unknown[]) => conversationUpdate(...args),
    },
    message: { upsert: (...args: unknown[]) => messageUpsert(...args) },
  },
}));

const triggerMock = vi.fn();
vi.mock("@trigger/handle-inbound", () => ({
  handleInboundTask: { trigger: (...args: unknown[]) => triggerMock(...args) },
}));

import { GET, POST } from "@/app/api/webhooks/whatsapp/route";

function signBody(body: string): string {
  const hex = crypto.createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
  return `sha256=${hex}`;
}

function samplePayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "999888777" },
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.SAMPLE123",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "Hi, how much for a video?" },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

describe("GET /api/webhooks/whatsapp (subscription verification)", () => {
  it("echoes the challenge when mode and token are correct", async () => {
    const url = `https://example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`;
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("returns 403 when the verify token is wrong", async () => {
    const url = `https://example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`;
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/webhooks/whatsapp", () => {
  beforeEach(() => {
    leadUpsert.mockReset().mockResolvedValue({ id: "lead_1", phoneE164: "+15551234567" });
    conversationFindFirst.mockReset().mockResolvedValue(null);
    conversationCreate.mockReset().mockResolvedValue({ id: "conv_1", leadId: "lead_1" });
    conversationUpdate.mockReset().mockResolvedValue({});
    messageUpsert.mockReset().mockResolvedValue({ id: "msg_1" });
    triggerMock.mockReset().mockResolvedValue({ id: "run_1" });
  });

  it("rejects a request with an invalid signature", async () => {
    const body = JSON.stringify(samplePayload());
    const request = new NextRequest("https://example.com/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=deadbeef", "content-type": "application/json" },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(messageUpsert).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("verifies signature, writes one message row, and enqueues exactly one task", async () => {
    const body = JSON.stringify(samplePayload());
    const request = new NextRequest("https://example.com/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "x-hub-signature-256": signBody(body),
        "content-type": "application/json",
      },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(messageUpsert).toHaveBeenCalledTimes(1);
    expect(triggerMock).toHaveBeenCalledTimes(1);

    const [createArgs] = messageUpsert.mock.calls[0];
    expect(createArgs.create.idempotencyKey).toBe("in:wamid.SAMPLE123");
    expect(createArgs.create.body).toBe("Hi, how much for a video?");
    expect(createArgs.create.direction).toBe("INBOUND");

    const [triggerPayload, triggerOptions] = triggerMock.mock.calls[0];
    expect(triggerPayload).toEqual({
      conversationId: "conv_1",
      messageId: "msg_1",
      waMessageId: "wamid.SAMPLE123",
    });
    expect(triggerOptions).toEqual({ concurrencyKey: "conv_1" });
  });

  it("populates senderPhoneNumberId from the webhook metadata when creating a new conversation", async () => {
    const body = JSON.stringify(samplePayload());
    const request = new NextRequest("https://example.com/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": signBody(body), "content-type": "application/json" },
      body,
    });

    await POST(request);

    expect(conversationCreate).toHaveBeenCalledWith({
      data: { leadId: "lead_1", senderPhoneNumberId: "999888777" },
    });
  });

  it("also sets senderPhoneNumberId on the update call when reusing an existing conversation", async () => {
    conversationFindFirst.mockResolvedValue({ id: "conv_existing", leadId: "lead_1" });

    const body = JSON.stringify(samplePayload());
    const request = new NextRequest("https://example.com/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": signBody(body), "content-type": "application/json" },
      body,
    });

    await POST(request);

    expect(conversationCreate).not.toHaveBeenCalled();
    expect(conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv_existing" },
      data: { lastInboundAt: expect.any(Date), senderPhoneNumberId: "999888777" },
    });
  });

  it("returns 200 without persisting anything for a non-message webhook change", async () => {
    const statusPayload = {
      object: "whatsapp_business_account",
      entry: [{ id: "e1", changes: [{ value: { statuses: [] }, field: "message_status" }] }],
    };
    const body = JSON.stringify(statusPayload);
    const request = new NextRequest("https://example.com/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": signBody(body), "content-type": "application/json" },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(messageUpsert).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
