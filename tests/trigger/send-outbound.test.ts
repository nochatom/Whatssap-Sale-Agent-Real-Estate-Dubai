import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const leadFindUniqueOrThrow = vi.fn();
const campaignFindUniqueOrThrow = vi.fn();
const conversationFindUniqueOrThrow = vi.fn();
const conversationUpdate = vi.fn();
const suppressionListFindUnique = vi.fn();
const messageCount = vi.fn();
const messageFindUnique = vi.fn();
const messageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findUniqueOrThrow: (...args: unknown[]) => leadFindUniqueOrThrow(...args) },
    campaign: { findUniqueOrThrow: (...args: unknown[]) => campaignFindUniqueOrThrow(...args) },
    conversation: {
      findUniqueOrThrow: (...args: unknown[]) => conversationFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => conversationUpdate(...args),
    },
    suppressionList: { findUnique: (...args: unknown[]) => suppressionListFindUnique(...args) },
    message: {
      count: (...args: unknown[]) => messageCount(...args),
      findUnique: (...args: unknown[]) => messageFindUnique(...args),
      create: (...args: unknown[]) => messageCreate(...args),
    },
  },
}));

const sendMessageMock = vi.fn();
const sendTemplateMessageMock = vi.fn();
vi.mock("@/whatsapp/transport", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessageMock(...args),
}));

const { sendOutbound } = await import("@trigger/send-outbound");

const BASE_PAYLOAD = {
  conversationId: "conv_1",
  campaignId: "camp_1",
  leadId: "lead_1",
  senderPhoneNumberId: "999888777",
  idempotencyKey: "out:reply:conv_1:wamid.1",
  body: "AED 500 for 1-2 properties.",
};

function mockPassingGate() {
  suppressionListFindUnique.mockResolvedValue(null);
  messageCount.mockResolvedValue(0);
  messageFindUnique.mockResolvedValue(null);
}

describe("sendOutbound", () => {
  const originalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalSendingEnabled = process.env.SENDING_ENABLED;
  const originalTemplateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE;

  beforeEach(() => {
    leadFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "lead_1",
      phoneE164: "+15551234567",
      optedIn: true,
    });
    campaignFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "camp_1",
      status: "ACTIVE",
      dailyBudgetPerNumber: 100,
      templateName: "property_video_intro",
      templateStatus: "APPROVED",
    });
    conversationFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "conv_1",
      lastInboundAt: new Date(),
    });
    conversationUpdate.mockReset().mockResolvedValue({});
    messageCreate.mockReset().mockResolvedValue({ id: "msg_out_1" });
    sendMessageMock.mockReset();
    sendTemplateMessageMock.mockReset();
    mockPassingGate();
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en_US";
  });

  afterEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = originalAccessToken;
    process.env.SENDING_ENABLED = originalSendingEnabled;
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = originalTemplateLanguage;
  });

  it("blocks and never calls sendMessage when the lead is suppressed", async () => {
    suppressionListFindUnique.mockResolvedValue({ id: "sup_1", phoneE164: "+15551234567" });

    const result = await sendOutbound(BASE_PAYLOAD);

    expect(result).toEqual({ sent: false, blockedBy: "suppression" });
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("blocks and never calls sendMessage when the daily budget is exhausted", async () => {
    messageCount.mockResolvedValue(100); // equals dailyBudgetPerNumber

    const result = await sendOutbound(BASE_PAYLOAD);

    expect(result).toEqual({ sent: false, blockedBy: "daily_budget_exceeded" });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("blocks and never calls sendMessage when the idempotency key already exists", async () => {
    messageFindUnique.mockResolvedValue({ id: "existing_msg" });

    const result = await sendOutbound(BASE_PAYLOAD);

    expect(result).toEqual({ sent: false, blockedBy: "idempotency_conflict" });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("blocks a free-text send outside the 24h service window", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    const result = await sendOutbound(BASE_PAYLOAD);

    expect(result).toEqual({ sent: false, blockedBy: "service_window_closed" });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("throws when body is missing for a non-template send, before touching the database", async () => {
    await expect(sendOutbound({ ...BASE_PAYLOAD, body: undefined })).rejects.toThrow(
      /body is required/,
    );
    expect(leadFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("sends, persists an OUTBOUND Message, and updates lastOutboundAt when every gate passes", async () => {
    sendMessageMock.mockResolvedValue({ waMessageId: "wamid.OUT1" });

    const result = await sendOutbound(BASE_PAYLOAD);

    expect(result).toEqual({ sent: true, waMessageId: "wamid.OUT1", messageId: "msg_out_1" });

    expect(sendMessageMock).toHaveBeenCalledWith({
      to: "+15551234567",
      body: BASE_PAYLOAD.body,
      phoneNumberId: BASE_PAYLOAD.senderPhoneNumberId,
      accessToken: "test-token",
    });

    const [createArgs] = messageCreate.mock.calls[0];
    expect(createArgs.data).toMatchObject({
      conversationId: "conv_1",
      direction: "OUTBOUND",
      waMessageId: "wamid.OUT1",
      idempotencyKey: BASE_PAYLOAD.idempotencyKey,
      status: "SENT",
      type: "text",
      templateName: null,
    });

    expect(conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { lastOutboundAt: expect.any(Date) },
    });
  });

  it("throws and never calls sendMessage when WHATSAPP_ACCESS_TOKEN is unset", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    await expect(sendOutbound(BASE_PAYLOAD)).rejects.toThrow(/WHATSAPP_ACCESS_TOKEN/);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  describe("template sends", () => {
    const TEMPLATE_PAYLOAD = {
      conversationId: "conv_1",
      campaignId: "camp_1",
      leadId: "lead_1",
      senderPhoneNumberId: "999888777",
      idempotencyKey: "out:campaign:camp_1:lead_1",
      isTemplate: true,
    };

    it("blocks and never calls sendTemplateMessage when the campaign's template is not APPROVED", async () => {
      campaignFindUniqueOrThrow.mockResolvedValue({
        id: "camp_1",
        status: "ACTIVE",
        dailyBudgetPerNumber: 100,
        templateName: "property_video_intro",
        templateStatus: "PENDING",
      });

      const result = await sendOutbound(TEMPLATE_PAYLOAD);

      expect(result).toEqual({ sent: false, blockedBy: "template_not_approved" });
      expect(sendTemplateMessageMock).not.toHaveBeenCalled();
    });

    it("passes the service-window check for a template send with no prior inbound message", async () => {
      conversationFindUniqueOrThrow.mockResolvedValue({ id: "conv_1", lastInboundAt: null });
      sendTemplateMessageMock.mockResolvedValue({ waMessageId: "wamid.TPL1" });

      const result = await sendOutbound(TEMPLATE_PAYLOAD);

      expect(result).toEqual({ sent: true, waMessageId: "wamid.TPL1", messageId: "msg_out_1" });
    });

    it("uses campaign.templateName and WHATSAPP_TEMPLATE_LANGUAGE, and persists a null body", async () => {
      sendTemplateMessageMock.mockResolvedValue({ waMessageId: "wamid.TPL1" });

      await sendOutbound(TEMPLATE_PAYLOAD);

      expect(sendTemplateMessageMock).toHaveBeenCalledWith({
        to: "+15551234567",
        phoneNumberId: "999888777",
        accessToken: "test-token",
        templateName: "property_video_intro",
        templateLanguage: "en_US",
      });
      expect(sendMessageMock).not.toHaveBeenCalled();

      const [createArgs] = messageCreate.mock.calls[0];
      expect(createArgs.data).toMatchObject({
        type: "template",
        body: null,
        templateName: "property_video_intro",
      });
    });

    it("throws and never sends when WHATSAPP_TEMPLATE_LANGUAGE is unset, rather than guessing a language", async () => {
      delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;

      await expect(sendOutbound(TEMPLATE_PAYLOAD)).rejects.toThrow(/WHATSAPP_TEMPLATE_LANGUAGE/);
      expect(sendTemplateMessageMock).not.toHaveBeenCalled();
    });

    it("throws and never touches the database when isTemplate is true but campaignId is missing", async () => {
      await expect(
        sendOutbound({ ...TEMPLATE_PAYLOAD, campaignId: undefined }),
      ).rejects.toThrow(/no organic template/);
      expect(leadFindUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("organic sends (no campaignId)", () => {
    const ORGANIC_PAYLOAD = {
      conversationId: "conv_organic",
      leadId: "lead_1",
      senderPhoneNumberId: "999888777",
      idempotencyKey: "out:reply:conv_organic:wamid.9",
      body: "Sure, happy to help — what platform is this for?",
    };

    beforeEach(() => {
      conversationFindUniqueOrThrow.mockResolvedValue({
        id: "conv_organic",
        lastInboundAt: new Date(),
      });
    });

    it("never looks up a campaign when campaignId is absent", async () => {
      sendMessageMock.mockResolvedValue({ waMessageId: "wamid.ORG1" });

      await sendOutbound(ORGANIC_PAYLOAD);

      expect(campaignFindUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("sends and persists a Message with no campaign, once every other gate passes", async () => {
      sendMessageMock.mockResolvedValue({ waMessageId: "wamid.ORG1" });

      const result = await sendOutbound(ORGANIC_PAYLOAD);

      expect(result).toEqual({ sent: true, waMessageId: "wamid.ORG1", messageId: "msg_out_1" });
      expect(sendMessageMock).toHaveBeenCalledWith({
        to: "+15551234567",
        body: ORGANIC_PAYLOAD.body,
        phoneNumberId: "999888777",
        accessToken: "test-token",
      });
    });

    it("still blocks on suppression for an organic send — unweakened", async () => {
      suppressionListFindUnique.mockResolvedValue({ id: "sup_1", phoneE164: "+15551234567" });

      const result = await sendOutbound(ORGANIC_PAYLOAD);

      expect(result).toEqual({ sent: false, blockedBy: "suppression" });
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("still blocks on opt-out for an organic send — unweakened", async () => {
      leadFindUniqueOrThrow.mockResolvedValue({
        id: "lead_1",
        phoneE164: "+15551234567",
        optedIn: false,
      });

      const result = await sendOutbound(ORGANIC_PAYLOAD);

      expect(result).toEqual({ sent: false, blockedBy: "opt_out" });
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("still requires an open 24h service window for an organic send — unweakened", async () => {
      conversationFindUniqueOrThrow.mockResolvedValue({ id: "conv_organic", lastInboundAt: null });

      const result = await sendOutbound(ORGANIC_PAYLOAD);

      expect(result).toEqual({ sent: false, blockedBy: "service_window_closed" });
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("still blocks on idempotency conflict for an organic send — unweakened", async () => {
      messageFindUnique.mockResolvedValue({ id: "existing" });

      const result = await sendOutbound(ORGANIC_PAYLOAD);

      expect(result).toEqual({ sent: false, blockedBy: "idempotency_conflict" });
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("is not gated by daily budget — there is no campaign to source a limit from", async () => {
      // messageCount deliberately left high; with no campaign there is no
      // dailyBudgetPerNumber to compare it against, so this must not block.
      messageCount.mockResolvedValue(99999);
      sendMessageMock.mockResolvedValue({ waMessageId: "wamid.ORG2" });

      const result = await sendOutbound(ORGANIC_PAYLOAD);

      expect(result.sent).toBe(true);
    });
  });
});
