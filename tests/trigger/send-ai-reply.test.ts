import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const messageFindFirst = vi.fn();
const messageFindMany = vi.fn();
const conversationFindUniqueOrThrow = vi.fn();
const aiDecisionCreate = vi.fn();
const campaignFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findFirst: (...args: unknown[]) => messageFindFirst(...args),
      findMany: (...args: unknown[]) => messageFindMany(...args),
    },
    conversation: { findUniqueOrThrow: (...args: unknown[]) => conversationFindUniqueOrThrow(...args) },
    aiDecision: { create: (...args: unknown[]) => aiDecisionCreate(...args) },
    campaign: { findUniqueOrThrow: (...args: unknown[]) => campaignFindUniqueOrThrow(...args) },
  },
}));

const invokeSkillMock = vi.fn();
vi.mock("@/skill/invoke", () => ({
  invokeSkill: (...args: unknown[]) => invokeSkillMock(...args),
}));

const sendOutboundTrigger = vi.fn();
vi.mock("@trigger/send-outbound", () => ({
  sendOutboundTask: { trigger: (...args: unknown[]) => sendOutboundTrigger(...args) },
}));

const { sendAiReply } = await import("@trigger/send-ai-reply");

const PAYLOAD = {
  conversationId: "conv_1",
  triggeringMessageId: "msg_2",
  triggeringWaMessageId: "wamid.2",
};

const BASE_DECISION_FIELDS = {
  clientAnalysis: {
    clientSector: "Airbnb host",
    clientType: "one",
    salesStage: "asking for price",
    clientIntent: "wants a quote",
    psychologicalInterpretation: "Most likely comparing suppliers.",
    buyingSignal: { level: "MEDIUM" as const, evidence: "asked how much" },
    mainConcern: "price",
    whatClientIsLookingFor: "a fair price",
  },
  salesStrategy: {
    bestNextAction: "give a price",
    whatToAvoid: "deflecting again",
    objectiveOfReply: "quote the price",
  },
};

describe("sendAiReply", () => {
  beforeEach(() => {
    messageFindFirst.mockReset().mockResolvedValue({
      id: "msg_2",
      type: "text",
      body: "how much?",
    });
    messageFindMany.mockReset().mockResolvedValue([]);
    conversationFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    aiDecisionCreate.mockReset().mockResolvedValue({ id: "decision_1" });
    campaignFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "camp_1",
      senderPhoneNumberId: "999888777",
    });
    invokeSkillMock.mockReset();
    sendOutboundTrigger.mockReset().mockResolvedValue({ id: "run_x" });
  });

  it("aborts without invoking the Skill when a newer inbound message has arrived", async () => {
    messageFindFirst.mockResolvedValue({ id: "msg_3", type: "text", body: "actually never mind" });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({
      evaluated: false,
      reason: "a newer inbound message arrived; its own scheduled run will handle it",
    });
    expect(invokeSkillMock).not.toHaveBeenCalled();
    expect(aiDecisionCreate).not.toHaveBeenCalled();
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("aborts without invoking the Skill when there is no inbound message at all (defensive)", async () => {
    messageFindFirst.mockResolvedValue(null);

    const result = await sendAiReply(PAYLOAD);

    expect(result.evaluated).toBe(false);
    expect(invokeSkillMock).not.toHaveBeenCalled();
  });

  it("invokes the Skill fresh, with the full current history, when it is still the latest message", async () => {
    messageFindMany.mockResolvedValue([
      { direction: "OUTBOUND", body: "Hi!", createdAt: new Date("2026-08-01T10:00:00Z") },
      { direction: "INBOUND", body: "how much?", createdAt: new Date("2026-08-01T10:05:00Z") },
    ]);
    invokeSkillMock.mockResolvedValue({
      status: "success",
      rawOutput: "CLIENT ANALYSIS\n...",
      decision: {
        ...BASE_DECISION_FIELDS,
        recommendedReply: { kind: "reply" as const, text: "AED 500 for 1-2 properties." },
      },
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({ evaluated: true, status: "success", replyTriggered: true });

    expect(invokeSkillMock).toHaveBeenCalledOnce();
    const [context] = invokeSkillMock.mock.calls[0];
    expect(context.behaviorState).toBe("A");
    expect(context.messages).toHaveLength(2);

    expect(aiDecisionCreate).toHaveBeenCalledOnce();
    const [createArgs] = aiDecisionCreate.mock.calls[0];
    expect(createArgs.data.messageId).toBe("msg_2");
    expect(createArgs.data.parseStatus).toBe("SUCCESS");

    expect(sendOutboundTrigger).toHaveBeenCalledWith(
      {
        conversationId: "conv_1",
        campaignId: "camp_1",
        leadId: "lead_1",
        senderPhoneNumberId: "999888777",
        idempotencyKey: "out:reply:conv_1:wamid.2",
        body: "AED 500 for 1-2 properties.",
      },
      { concurrencyKey: "999888777" },
    );
  });

  it("does not trigger send-outbound when the decision is do_not_reply_yet", async () => {
    invokeSkillMock.mockResolvedValue({
      status: "success",
      rawOutput: "...",
      decision: {
        ...BASE_DECISION_FIELDS,
        recommendedReply: {
          kind: "do_not_reply_yet" as const,
          reason: "too soon",
          trigger: "wait for a read receipt",
        },
      },
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({ evaluated: true, status: "success", replyTriggered: false });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("does not trigger send-outbound when the conversation has no campaign", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      leadId: "lead_1",
      campaignId: null,
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    invokeSkillMock.mockResolvedValue({
      status: "success",
      rawOutput: "...",
      decision: {
        ...BASE_DECISION_FIELDS,
        recommendedReply: { kind: "reply" as const, text: "AED 500 for 1-2 properties." },
      },
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({
      evaluated: true,
      status: "success",
      replyTriggered: false,
      replySkipped: "conversation has no associated campaign",
    });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("persists a PARSE_FAILURE AiDecision with a null parsedDecision, never a guessed default", async () => {
    invokeSkillMock.mockResolvedValue({
      status: "parse_failure",
      reason: "extraction output was not valid JSON",
      rawOutput: "garbled",
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({ evaluated: true, status: "parse_failure", replyTriggered: false });

    const [createArgs] = aiDecisionCreate.mock.calls[0];
    expect(createArgs.data.parseStatus).toBe("PARSE_FAILURE");
    expect(createArgs.data.parsedDecision).toBe(Prisma.JsonNull);
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });
});
