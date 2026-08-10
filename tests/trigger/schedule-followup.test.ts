import { beforeEach, describe, expect, it, vi } from "vitest";

const followUpFindUniqueOrThrow = vi.fn();
const followUpUpdate = vi.fn();
const conversationFindUniqueOrThrow = vi.fn();
const messageFindMany = vi.fn();
const aiDecisionCreate = vi.fn();
const campaignFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    followUp: {
      findUniqueOrThrow: (...args: unknown[]) => followUpFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => followUpUpdate(...args),
    },
    conversation: {
      findUniqueOrThrow: (...args: unknown[]) => conversationFindUniqueOrThrow(...args),
    },
    message: { findMany: (...args: unknown[]) => messageFindMany(...args) },
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

const { runScheduledFollowUp, scheduleFollowUp, scheduleFollowUpTask } = await import(
  "@trigger/schedule-followup"
);

const CREATED_AT = new Date("2026-08-01T10:00:00Z");
const PAYLOAD = { conversationId: "conv_1", leadId: "lead_1", followUpId: "fu_1" };

function successDecision(kind: "reply" | "do_not_reply_yet" = "reply") {
  const recommendedReply =
    kind === "reply"
      ? { kind: "reply" as const, text: "Still there? Happy to answer anything." }
      : { kind: "do_not_reply_yet" as const, reason: "no new trigger", trigger: "wait longer" };
  return {
    status: "success" as const,
    rawOutput: "CLIENT ANALYSIS\n...",
    decision: {
      clientAnalysis: {
        clientSector: "Airbnb host",
        clientType: "one",
        salesStage: "follow-up",
        clientIntent: "unclear",
        psychologicalInterpretation: "Most likely busy.",
        buyingSignal: { level: "LOW", evidence: "no reply in 48h" },
        mainConcern: "unknown",
        whatClientIsLookingFor: "unknown",
      },
      salesStrategy: {
        bestNextAction: kind === "reply" ? "follow up" : "wait",
        whatToAvoid: "chasing",
        objectiveOfReply: "re-engage",
      },
      recommendedReply,
    },
  };
}

describe("runScheduledFollowUp", () => {
  beforeEach(() => {
    followUpFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "fu_1",
      status: "PENDING",
      createdAt: CREATED_AT,
    });
    followUpUpdate.mockReset().mockResolvedValue({});
    conversationFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "conv_1",
      campaignId: "camp_1",
      lastInboundAt: new Date("2026-08-01T09:00:00Z"), // before the follow-up was created
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    messageFindMany.mockReset().mockResolvedValue([]);
    aiDecisionCreate.mockReset().mockResolvedValue({ id: "decision_1" });
    campaignFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "camp_1",
      senderPhoneNumberId: "999888777",
    });
    invokeSkillMock.mockReset();
    sendOutboundTrigger.mockReset().mockResolvedValue({ id: "run_1" });
  });

  it("no-ops without invoking the Skill when the follow-up is no longer PENDING", async () => {
    followUpFindUniqueOrThrow.mockResolvedValue({ id: "fu_1", status: "CANCELLED", createdAt: CREATED_AT });

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({ actioned: false, reason: "follow-up already CANCELLED" });
    expect(invokeSkillMock).not.toHaveBeenCalled();
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("cancels without invoking the Skill when the customer replied after scheduling", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      campaignId: "camp_1",
      lastInboundAt: new Date("2026-08-02T00:00:00Z"), // after CREATED_AT
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({ actioned: false, reason: "customer replied since scheduling" });
    expect(invokeSkillMock).not.toHaveBeenCalled();
    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_1" }, data: { status: "CANCELLED" } });
  });

  it("invokes the Skill as behavior state F", async () => {
    invokeSkillMock.mockResolvedValue(successDecision("do_not_reply_yet"));

    await runScheduledFollowUp(PAYLOAD);

    const [context] = invokeSkillMock.mock.calls[0];
    expect(context.behaviorState).toBe("F");
  });

  it("cancels and does not auto-reschedule when the Skill call fails to parse", async () => {
    invokeSkillMock.mockResolvedValue({ status: "parse_failure", reason: "bad json", rawOutput: "x" });

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({ actioned: false, reason: "Skill call did not parse; not auto-rescheduling" });
    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_1" }, data: { status: "CANCELLED" } });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("cancels and does not auto-reschedule when the Skill says wait again", async () => {
    invokeSkillMock.mockResolvedValue(successDecision("do_not_reply_yet"));

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({
      actioned: false,
      reason: "Skill did not return a reply; not auto-rescheduling",
    });
    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_1" }, data: { status: "CANCELLED" } });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("cancels without sending when the conversation has no associated campaign", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      campaignId: null,
      lastInboundAt: new Date("2026-08-01T09:00:00Z"),
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    invokeSkillMock.mockResolvedValue(successDecision("reply"));

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({ actioned: false, reason: "conversation has no associated campaign" });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("triggers send-outbound and marks the follow-up SENT when the Skill returns a reply", async () => {
    invokeSkillMock.mockResolvedValue(successDecision("reply"));

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({ actioned: true });

    expect(sendOutboundTrigger).toHaveBeenCalledWith(
      {
        conversationId: "conv_1",
        campaignId: "camp_1",
        leadId: "lead_1",
        senderPhoneNumberId: "999888777",
        idempotencyKey: "out:followup:fu_1",
        body: "Still there? Happy to answer anything.",
      },
      { concurrencyKey: "999888777" },
    );

    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_1" }, data: { status: "SENT" } });
  });
});

describe("scheduleFollowUp", () => {
  const SCHEDULED_FOR = new Date("2026-08-05T12:00:00Z");

  beforeEach(() => {
    followUpFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "fu_1",
      conversationId: "conv_1",
      leadId: "lead_1",
      status: "PENDING",
      scheduledFor: SCHEDULED_FOR,
      createdAt: new Date("2026-08-01T10:00:00Z"),
    });
    followUpUpdate.mockReset().mockResolvedValue({});
  });

  it("triggers scheduleFollowUpTask with delay set to the absolute scheduledFor date, and persists triggerRunId", async () => {
    const triggerSpy = vi
      .spyOn(scheduleFollowUpTask, "trigger")
      .mockResolvedValue({ id: "run_scheduled_1" } as never);

    const result = await scheduleFollowUp("fu_1");

    expect(result).toEqual({ triggerRunId: "run_scheduled_1" });
    expect(triggerSpy).toHaveBeenCalledWith(
      { conversationId: "conv_1", leadId: "lead_1", followUpId: "fu_1" },
      { delay: SCHEDULED_FOR, concurrencyKey: "conv_1" },
    );
    expect(followUpUpdate).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { triggerRunId: "run_scheduled_1" },
    });

    triggerSpy.mockRestore();
  });

  it("throws without triggering anything when the FollowUp is not PENDING", async () => {
    followUpFindUniqueOrThrow.mockResolvedValue({
      id: "fu_1",
      conversationId: "conv_1",
      leadId: "lead_1",
      status: "CANCELLED",
      scheduledFor: SCHEDULED_FOR,
      createdAt: new Date("2026-08-01T10:00:00Z"),
    });
    const triggerSpy = vi.spyOn(scheduleFollowUpTask, "trigger").mockResolvedValue({} as never);

    await expect(scheduleFollowUp("fu_1")).rejects.toThrow(/not PENDING/);
    expect(triggerSpy).not.toHaveBeenCalled();

    triggerSpy.mockRestore();
  });
});
