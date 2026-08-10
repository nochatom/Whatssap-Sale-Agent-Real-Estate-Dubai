import { beforeEach, describe, expect, it, vi } from "vitest";

const messageFindUniqueOrThrow = vi.fn();
const followUpFindMany = vi.fn();
const followUpUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findUniqueOrThrow: (...args: unknown[]) => messageFindUniqueOrThrow(...args),
    },
    followUp: {
      findMany: (...args: unknown[]) => followUpFindMany(...args),
      update: (...args: unknown[]) => followUpUpdate(...args),
    },
  },
}));

const sendAiReplyTrigger = vi.fn();
vi.mock("@trigger/send-ai-reply", () => ({
  sendAiReplyTask: { trigger: (...args: unknown[]) => sendAiReplyTrigger(...args) },
}));

// Real logger/task pass through unchanged; only runs.cancel is replaced so a
// test never attempts a real call to Trigger.dev's API.
const runsCancelMock = vi.fn();
vi.mock("@trigger.dev/sdk/v3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trigger.dev/sdk/v3")>();
  return {
    ...actual,
    runs: { ...actual.runs, cancel: (...args: unknown[]) => runsCancelMock(...args) },
  };
});

const { classifyBehaviorState, handleInbound } = await import("@trigger/handle-inbound");

describe("classifyBehaviorState (re-exported)", () => {
  it("classifies a text message with a body as state A", () => {
    expect(classifyBehaviorState({ type: "text", body: "how much?" })).toBe("A");
  });

  it("returns null for an unhandled media type", () => {
    expect(classifyBehaviorState({ type: "image", body: null })).toBeNull();
  });
});

describe("handleInbound", () => {
  beforeEach(() => {
    messageFindUniqueOrThrow.mockReset();
    followUpFindMany.mockReset().mockResolvedValue([]);
    followUpUpdate.mockReset().mockResolvedValue({});
    sendAiReplyTrigger.mockReset().mockResolvedValue({ id: "run_new" });
    runsCancelMock.mockReset().mockResolvedValue({});
  });

  it("skips scheduling for an unclassifiable message type", async () => {
    messageFindUniqueOrThrow.mockResolvedValue({ id: "msg_1", type: "image", body: null });

    const result = await handleInbound({
      conversationId: "conv_1",
      messageId: "msg_1",
      waMessageId: "wamid.1",
    });

    expect(result).toEqual({ invoked: false, reason: "unclassifiable message type" });
    expect(sendAiReplyTrigger).not.toHaveBeenCalled();
    expect(followUpFindMany).not.toHaveBeenCalled();
  });

  it("schedules send-ai-reply with a 2-minute delay, keyed by conversationId", async () => {
    messageFindUniqueOrThrow.mockResolvedValue({ id: "msg_2", type: "text", body: "how much?" });

    const result = await handleInbound({
      conversationId: "conv_1",
      messageId: "msg_2",
      waMessageId: "wamid.2",
    });

    expect(result).toEqual({ invoked: true, replyScheduled: true });
    expect(sendAiReplyTrigger).toHaveBeenCalledWith(
      { conversationId: "conv_1", triggeringMessageId: "msg_2", triggeringWaMessageId: "wamid.2" },
      { delay: "2m", concurrencyKey: "conv_1" },
    );
  });

  it("cancels every PENDING follow-up for the conversation via runs.cancel", async () => {
    messageFindUniqueOrThrow.mockResolvedValue({ id: "msg_2", type: "text", body: "hi" });
    followUpFindMany.mockResolvedValue([
      { id: "fu_1", status: "PENDING", triggerRunId: "run_abc" },
      { id: "fu_2", status: "PENDING", triggerRunId: null },
    ]);

    await handleInbound({ conversationId: "conv_1", messageId: "msg_2", waMessageId: "wamid.2" });

    expect(followUpFindMany).toHaveBeenCalledWith({
      where: { conversationId: "conv_1", status: "PENDING" },
    });
    expect(runsCancelMock).toHaveBeenCalledWith("run_abc");
    expect(runsCancelMock).toHaveBeenCalledOnce(); // fu_2 has no triggerRunId, nothing to cancel
    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_1" }, data: { status: "CANCELLED" } });
    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_2" }, data: { status: "CANCELLED" } });
  });

  it("still marks a follow-up CANCELLED and still schedules the reply even if runs.cancel throws", async () => {
    messageFindUniqueOrThrow.mockResolvedValue({ id: "msg_2", type: "text", body: "hi" });
    followUpFindMany.mockResolvedValue([{ id: "fu_1", status: "PENDING", triggerRunId: "run_abc" }]);
    runsCancelMock.mockRejectedValue(new Error("run already completed"));

    const result = await handleInbound({
      conversationId: "conv_1",
      messageId: "msg_2",
      waMessageId: "wamid.2",
    });

    expect(result).toEqual({ invoked: true, replyScheduled: true });
    expect(followUpUpdate).toHaveBeenCalledWith({ where: { id: "fu_1" }, data: { status: "CANCELLED" } });
    expect(sendAiReplyTrigger).toHaveBeenCalledOnce();
  });
});
