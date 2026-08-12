import { beforeEach, describe, expect, it, vi } from "vitest";

const followUpFindUniqueOrThrow = vi.fn();
const followUpUpdate = vi.fn();
const followUpCreate = vi.fn();
const conversationFindUniqueOrThrow = vi.fn();
const messageFindMany = vi.fn();
const aiDecisionCreate = vi.fn();
const campaignFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    followUp: {
      findUniqueOrThrow: (...args: unknown[]) => followUpFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => followUpUpdate(...args),
      create: (...args: unknown[]) => followUpCreate(...args),
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

const { runScheduledFollowUp, scheduleFollowUp, scheduleFollowUpTask, maybeScheduleFollowUp } =
  await import("@trigger/schedule-followup");

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

  it("cancels without sending when there is no campaign and no known sender number", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      campaignId: null,
      senderPhoneNumberId: null,
      lastInboundAt: new Date("2026-08-01T09:00:00Z"),
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    invokeSkillMock.mockResolvedValue(successDecision("reply"));

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({
      actioned: false,
      reason: "no campaign and no known sender number for this conversation",
    });
    expect(sendOutboundTrigger).not.toHaveBeenCalled();
  });

  it("sends organically, using conversation.senderPhoneNumberId, when there is no campaign", async () => {
    conversationFindUniqueOrThrow.mockResolvedValue({
      id: "conv_1",
      campaignId: null,
      senderPhoneNumberId: "999888777",
      lastInboundAt: new Date("2026-08-01T09:00:00Z"),
      lead: { id: "lead_1", phoneE164: "+15551234567" },
    });
    invokeSkillMock.mockResolvedValue(successDecision("reply"));

    const result = await runScheduledFollowUp(PAYLOAD);

    expect(result).toEqual({ actioned: true });
    expect(campaignFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(sendOutboundTrigger).toHaveBeenCalledWith(
      {
        conversationId: "conv_1",
        campaignId: undefined,
        leadId: "lead_1",
        senderPhoneNumberId: "999888777",
        idempotencyKey: "out:followup:fu_1",
        body: "Still there? Happy to answer anything.",
      },
      { concurrencyKey: "999888777" },
    );
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

describe("maybeScheduleFollowUp", () => {
  const followUpDecision = {
    clientAnalysis: {
      clientSector: "Airbnb host",
      clientType: "one",
      salesStage: "follow-up",
      clientIntent: "unclear",
      psychologicalInterpretation: "Most likely busy.",
      buyingSignal: { level: "LOW" as const, evidence: "message unopened" },
      mainConcern: "unknown",
      whatClientIsLookingFor: "unknown",
    },
    salesStrategy: { bestNextAction: "wait", whatToAvoid: "chasing", objectiveOfReply: "re-engage" },
    recommendedReply: {
      kind: "do_not_follow_up_yet" as const,
      reason: "message delivered but not read",
      trigger: "re-check after the configured delay",
    },
  };

  beforeEach(() => {
    followUpCreate.mockReset().mockResolvedValue({ id: "fu_new" });
    campaignFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "camp_1",
      senderPhoneNumberId: "999888777",
      followUpDelayMinutes: 60,
    });
    followUpFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "fu_new",
      conversationId: "conv_1",
      leadId: "lead_1",
      status: "PENDING",
      scheduledFor: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
    });
    followUpUpdate.mockReset().mockResolvedValue({});
  });

  it("does nothing when the decision does not explicitly require a follow-up", async () => {
    const result = await maybeScheduleFollowUp({
      conversationId: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      decision: { ...followUpDecision, recommendedReply: { kind: "reply", text: "hi" } },
    });

    expect(result).toEqual({
      scheduled: false,
      reason: "decision does not explicitly require a follow-up",
    });
    expect(followUpCreate).not.toHaveBeenCalled();
  });

  it("does not schedule when there is no campaign — no interval source", async () => {
    const result = await maybeScheduleFollowUp({
      conversationId: "conv_1",
      leadId: "lead_1",
      campaignId: null,
      decision: followUpDecision,
    });

    expect(result).toEqual({
      scheduled: false,
      reason: "conversation has no campaign to source a follow-up interval from",
    });
    expect(followUpCreate).not.toHaveBeenCalled();
  });

  it("does not schedule when the campaign has no followUpDelayMinutes configured", async () => {
    campaignFindUniqueOrThrow.mockResolvedValue({
      id: "camp_1",
      senderPhoneNumberId: "999888777",
      followUpDelayMinutes: null,
    });

    const result = await maybeScheduleFollowUp({
      conversationId: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      decision: followUpDecision,
    });

    expect(result).toEqual({
      scheduled: false,
      reason: "campaign.followUpDelayMinutes is not configured",
    });
    expect(followUpCreate).not.toHaveBeenCalled();
  });

  it("does not schedule when followUpDelayMinutes is not positive", async () => {
    campaignFindUniqueOrThrow.mockResolvedValue({
      id: "camp_1",
      senderPhoneNumberId: "999888777",
      followUpDelayMinutes: 0,
    });

    const result = await maybeScheduleFollowUp({
      conversationId: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      decision: followUpDecision,
    });

    expect(result).toEqual({
      scheduled: false,
      reason: "campaign.followUpDelayMinutes must be positive",
    });
    expect(followUpCreate).not.toHaveBeenCalled();
  });

  it("creates a FollowUp scheduledFor now + followUpDelayMinutes, schedules it, and returns its id", async () => {
    const triggerSpy = vi
      .spyOn(scheduleFollowUpTask, "trigger")
      .mockResolvedValue({ id: "run_new" } as never);
    const before = Date.now();

    const result = await maybeScheduleFollowUp({
      conversationId: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      decision: followUpDecision,
      triggerAiDecisionId: "decision_9",
    });

    expect(result.scheduled).toBe(true);
    if (result.scheduled) {
      expect(result.followUpId).toBe("fu_new");
      const deltaMs = result.scheduledFor.getTime() - before;
      expect(deltaMs).toBeGreaterThan(59 * 60_000);
      expect(deltaMs).toBeLessThan(61 * 60_000);
    }

    const [createArgs] = followUpCreate.mock.calls[0];
    expect(createArgs.data).toMatchObject({
      conversationId: "conv_1",
      leadId: "lead_1",
      reason: "message delivered but not read",
      triggerAiDecisionId: "decision_9",
    });

    // scheduleFollowUp() was called internally, connecting the new row to Trigger.dev.
    expect(triggerSpy).toHaveBeenCalledWith(
      { conversationId: "conv_1", leadId: "lead_1", followUpId: "fu_new" },
      expect.objectContaining({ concurrencyKey: "conv_1" }),
    );
    expect(followUpUpdate).toHaveBeenCalledWith({
      where: { id: "fu_new" },
      data: { triggerRunId: "run_new" },
    });

    triggerSpy.mockRestore();
  });
});
