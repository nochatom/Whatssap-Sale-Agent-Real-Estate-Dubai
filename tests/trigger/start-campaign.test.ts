import { beforeEach, describe, expect, it, vi } from "vitest";

const campaignFindUniqueOrThrow = vi.fn();
const conversationFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findUniqueOrThrow: (...args: unknown[]) => campaignFindUniqueOrThrow(...args) },
    conversation: { findMany: (...args: unknown[]) => conversationFindMany(...args) },
  },
}));

const sendOutboundTrigger = vi.fn();
vi.mock("@trigger/send-outbound", () => ({
  sendOutboundTask: { trigger: (...args: unknown[]) => sendOutboundTrigger(...args) },
}));

const { startCampaign } = await import("@trigger/start-campaign");

describe("startCampaign", () => {
  beforeEach(() => {
    campaignFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "camp_1",
      status: "ACTIVE",
      templateStatus: "APPROVED",
      senderPhoneNumberId: "999888777",
    });
    conversationFindMany.mockReset().mockResolvedValue([]);
    sendOutboundTrigger.mockReset().mockResolvedValue({ id: "run_x" });
  });

  it("does not schedule anything when the campaign is not ACTIVE", async () => {
    campaignFindUniqueOrThrow.mockResolvedValue({
      id: "camp_1",
      status: "DRAFT",
      templateStatus: "APPROVED",
      senderPhoneNumberId: "999888777",
    });

    const result = await startCampaign({ campaignId: "camp_1" });

    expect(result).toEqual({ started: false, reason: "campaign status is DRAFT, not ACTIVE" });
    expect(conversationFindMany).not.toHaveBeenCalled();
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("does not schedule anything when the template is not APPROVED", async () => {
    campaignFindUniqueOrThrow.mockResolvedValue({
      id: "camp_1",
      status: "ACTIVE",
      templateStatus: "PENDING",
      senderPhoneNumberId: "999888777",
    });

    const result = await startCampaign({ campaignId: "camp_1" });

    expect(result).toEqual({
      started: false,
      reason: "template status is PENDING, not APPROVED",
    });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("schedules one send-outbound per conversation, staggered 4 minutes apart, as templates", async () => {
    conversationFindMany.mockResolvedValue([
      { id: "conv_1", leadId: "lead_1", campaignId: "camp_1" },
      { id: "conv_2", leadId: "lead_2", campaignId: "camp_1" },
      { id: "conv_3", leadId: "lead_3", campaignId: "camp_1" },
    ]);

    const result = await startCampaign({ campaignId: "camp_1" });

    expect(result).toEqual({ started: true, conversationsTargeted: 3 });
    expect(sendOutboundTrigger).toHaveBeenCalledTimes(3);

    expect(sendOutboundTrigger).toHaveBeenNthCalledWith(
      1,
      {
        conversationId: "conv_1",
        campaignId: "camp_1",
        leadId: "lead_1",
        senderPhoneNumberId: "999888777",
        idempotencyKey: "out:campaign:camp_1:lead_1",
        isTemplate: true,
      },
      { concurrencyKey: "999888777" },
    );
    expect(sendOutboundTrigger).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ conversationId: "conv_2", idempotencyKey: "out:campaign:camp_1:lead_2" }),
      { concurrencyKey: "999888777", delay: "4m" },
    );
    expect(sendOutboundTrigger).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ conversationId: "conv_3", idempotencyKey: "out:campaign:camp_1:lead_3" }),
      { concurrencyKey: "999888777", delay: "8m" },
    );
  });
});
