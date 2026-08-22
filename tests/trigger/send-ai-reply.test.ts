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
// isRetryableProviderUnavailable / nextCloudflareQuotaResetAt stay real (pure,
// deterministic-enough functions) — only invokeSkill itself is mocked.
vi.mock("@/skill/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/skill/invoke")>();
  return {
    ...actual,
    invokeSkill: (...args: unknown[]) => invokeSkillMock(...args),
  };
});

const sendOutboundTrigger = vi.fn();
vi.mock("@trigger/send-outbound", () => ({
  sendOutboundTask: { trigger: (...args: unknown[]) => sendOutboundTrigger(...args) },
}));

const maybeScheduleFollowUpMock = vi.fn();
vi.mock("@trigger/schedule-followup", () => ({
  maybeScheduleFollowUp: (...args: unknown[]) => maybeScheduleFollowUpMock(...args),
}));

// Its own explicit mock (not the generic task()-replacement below) so its
// .trigger() calls land on a dedicated mock, never conflated with
// sendAiReplyTrigger's retry-scheduling assertions.
const telegramNotificationTrigger = vi.fn();
vi.mock("@trigger/send-telegram-notification", () => ({
  sendTelegramNotificationTask: { trigger: (...args: unknown[]) => telegramNotificationTrigger(...args) },
}));

// sendAiReplyTask is defined via task(...) inside send-ai-reply.ts itself, so
// it can't be mocked by mocking an external module the way sendOutboundTask
// is above — task() itself is replaced so the resulting task object's
// .trigger() is a controllable mock instead of a real Trigger.dev API call.
const sendAiReplyTrigger = vi.fn();
vi.mock("@trigger.dev/sdk/v3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trigger.dev/sdk/v3")>();
  return {
    ...actual,
    task: (config: { id: string }) => ({ id: config.id, trigger: (...args: unknown[]) => sendAiReplyTrigger(...args) }),
  };
});

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
    maybeScheduleFollowUpMock.mockReset().mockResolvedValue({ scheduled: false, reason: "n/a" });
    sendAiReplyTrigger.mockReset().mockResolvedValue({ id: "run_retry" });
    telegramNotificationTrigger.mockReset().mockResolvedValue({ id: "run_telegram" });
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

  it("does not trigger send-outbound when there is no campaign and no known sender number", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      leadId: "lead_1",
      campaignId: null,
      senderPhoneNumberId: null,
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
      replySkipped: "no campaign and no known sender number for this conversation",
    });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("sends organically, using conversation.senderPhoneNumberId, when there is no campaign", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      leadId: "lead_1",
      campaignId: null,
      senderPhoneNumberId: "999888777",
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    invokeSkillMock.mockResolvedValue({
      status: "success",
      rawOutput: "...",
      decision: {
        ...BASE_DECISION_FIELDS,
        recommendedReply: { kind: "reply" as const, text: "Sure, what platform is this for?" },
      },
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({ evaluated: true, status: "success", replyTriggered: true });
    expect(campaignFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(sendOutboundTrigger).toHaveBeenCalledWith(
      {
        conversationId: "conv_1",
        campaignId: undefined,
        leadId: "lead_1",
        senderPhoneNumberId: "999888777",
        idempotencyKey: "out:reply:conv_1:wamid.2",
        body: "Sure, what platform is this for?",
      },
      { concurrencyKey: "999888777" },
    );
  });

  it("calls maybeScheduleFollowUp when the decision explicitly requires a follow-up", async () => {
    aiDecisionCreate.mockResolvedValue({ id: "decision_42" });
    invokeSkillMock.mockResolvedValue({
      status: "success",
      rawOutput: "...",
      decision: {
        ...BASE_DECISION_FIELDS,
        recommendedReply: {
          kind: "do_not_follow_up_yet" as const,
          reason: "message unopened",
          trigger: "wait and check back",
        },
      },
    });
    maybeScheduleFollowUpMock.mockResolvedValue({
      scheduled: true,
      followUpId: "fu_1",
      scheduledFor: new Date(),
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({
      evaluated: true,
      status: "success",
      replyTriggered: false,
      followUpScheduled: true,
    });
    expect(maybeScheduleFollowUpMock).toHaveBeenCalledWith({
      conversationId: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      decision: expect.objectContaining({
        recommendedReply: expect.objectContaining({ kind: "do_not_follow_up_yet" }),
      }),
      triggerAiDecisionId: "decision_42",
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

  it("reschedules the same message after Cloudflare's quota reset instead of dropping it when no AI provider was reachable", async () => {
    invokeSkillMock.mockResolvedValue({
      status: "parse_failure",
      reason: "provider_unavailable_retry_after_quota_reset: Cloudflare Workers AI rate-limited or quota-exceeded: 429; no fallback provider configured",
      rawOutput: "",
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result.evaluated).toBe(true);
    if (result.evaluated) {
      expect(result.status).toBe("parse_failure");
      expect(result.replyTriggered).toBe(false);
      expect(typeof result.retryScheduledAt).toBe("string");
    }

    // The AiDecision audit trail is still persisted for this failed attempt.
    expect(aiDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parseStatus: "PARSE_FAILURE" }) }),
    );

    // Rescheduled with the exact same payload so the re-run naturally
    // re-checks staleness at its new fire time, same as the original schedule.
    expect(sendAiReplyTrigger).toHaveBeenCalledOnce();
    const [retryPayload, retryOptions] = sendAiReplyTrigger.mock.calls[0];
    expect(retryPayload).toEqual(PAYLOAD);
    expect(retryOptions.concurrencyKey).toBe("conv_1");
    expect(retryOptions.delay).toBeInstanceOf(Date);
    expect((retryOptions.delay as Date).getTime()).toBeGreaterThan(Date.now());

    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("does NOT reschedule an ordinary parse_failure (bad output, not a reachability failure)", async () => {
    invokeSkillMock.mockResolvedValue({
      status: "parse_failure",
      reason: "extraction output was not valid JSON",
      rawOutput: "garbled",
    });

    const result = await sendAiReply(PAYLOAD);

    expect(result).toEqual({ evaluated: true, status: "parse_failure", replyTriggered: false });
    expect(sendAiReplyTrigger).not.toHaveBeenCalled();
  });

  describe("Telegram milestone notification", () => {
    it("triggers a Telegram notification when milestone is payment_confirmed", async () => {
      invokeSkillMock.mockResolvedValue({
        status: "success",
        rawOutput: "...",
        decision: {
          ...BASE_DECISION_FIELDS,
          clientAnalysis: { ...BASE_DECISION_FIELDS.clientAnalysis, milestone: "payment_confirmed" as const },
          recommendedReply: { kind: "reply" as const, text: "Great, starting now!" },
        },
      });

      await sendAiReply(PAYLOAD);

      expect(telegramNotificationTrigger).toHaveBeenCalledWith({
        milestone: "payment_confirmed",
        leadPhoneE164: "+15551234567",
        triggeringMessageBody: "how much?",
      });
    });

    it("triggers a Telegram notification when milestone is ready_to_start", async () => {
      invokeSkillMock.mockResolvedValue({
        status: "success",
        rawOutput: "...",
        decision: {
          ...BASE_DECISION_FIELDS,
          clientAnalysis: { ...BASE_DECISION_FIELDS.clientAnalysis, milestone: "ready_to_start" as const },
          recommendedReply: { kind: "reply" as const, text: "Perfect, let's begin." },
        },
      });

      await sendAiReply(PAYLOAD);

      expect(telegramNotificationTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ milestone: "ready_to_start" }),
      );
    });

    it("does NOT trigger a Telegram notification when milestone is absent (existing decisions, unchanged)", async () => {
      invokeSkillMock.mockResolvedValue({
        status: "success",
        rawOutput: "...",
        decision: {
          ...BASE_DECISION_FIELDS,
          recommendedReply: { kind: "reply" as const, text: "AED 500 for 1-2 properties." },
        },
      });

      await sendAiReply(PAYLOAD);

      expect(telegramNotificationTrigger).not.toHaveBeenCalled();
    });

    it("does NOT trigger a Telegram notification when milestone is explicitly none", async () => {
      invokeSkillMock.mockResolvedValue({
        status: "success",
        rawOutput: "...",
        decision: {
          ...BASE_DECISION_FIELDS,
          clientAnalysis: { ...BASE_DECISION_FIELDS.clientAnalysis, milestone: "none" as const },
          recommendedReply: { kind: "reply" as const, text: "AED 500 for 1-2 properties." },
        },
      });

      await sendAiReply(PAYLOAD);

      expect(telegramNotificationTrigger).not.toHaveBeenCalled();
    });

    it("triggers even when the reply itself is do_not_reply_yet — milestone detection is independent of the reply decision", async () => {
      invokeSkillMock.mockResolvedValue({
        status: "success",
        rawOutput: "...",
        decision: {
          ...BASE_DECISION_FIELDS,
          clientAnalysis: { ...BASE_DECISION_FIELDS.clientAnalysis, milestone: "payment_confirmed" as const },
          recommendedReply: { kind: "do_not_reply_yet" as const, reason: "too soon", trigger: "wait" },
        },
      });

      await sendAiReply(PAYLOAD);

      expect(telegramNotificationTrigger).toHaveBeenCalledOnce();
      expect(sendOutboundTrigger).not.toHaveBeenCalled();
    });

    it("does NOT let a Telegram notification failure affect the WhatsApp reply that follows", async () => {
      telegramNotificationTrigger.mockRejectedValueOnce(new Error("TELEGRAM_BOT_TOKEN not set"));
      invokeSkillMock.mockResolvedValue({
        status: "success",
        rawOutput: "...",
        decision: {
          ...BASE_DECISION_FIELDS,
          clientAnalysis: { ...BASE_DECISION_FIELDS.clientAnalysis, milestone: "payment_confirmed" as const },
          recommendedReply: { kind: "reply" as const, text: "Great, starting now!" },
        },
      });

      const result = await sendAiReply(PAYLOAD);

      expect(result).toEqual({ evaluated: true, status: "success", replyTriggered: true });
      expect(sendOutboundTrigger).toHaveBeenCalledOnce();
    });

    it("never triggers Telegram on a parse_failure — there is no decision to read a milestone from", async () => {
      invokeSkillMock.mockResolvedValue({
        status: "parse_failure",
        reason: "extraction output was not valid JSON",
        rawOutput: "garbled",
      });

      await sendAiReply(PAYLOAD);

      expect(telegramNotificationTrigger).not.toHaveBeenCalled();
    });
  });
});
