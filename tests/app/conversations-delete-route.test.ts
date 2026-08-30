import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const followUpDeleteMany = vi.fn();
const aiDecisionDeleteMany = vi.fn();
const messageDeleteMany = vi.fn();
const conversationDeleteMany = vi.fn();
const conversationFindMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    followUp: { deleteMany: (...args: unknown[]) => followUpDeleteMany(...args) },
    aiDecision: { deleteMany: (...args: unknown[]) => aiDecisionDeleteMany(...args) },
    message: { deleteMany: (...args: unknown[]) => messageDeleteMany(...args) },
    conversation: {
      deleteMany: (...args: unknown[]) => conversationDeleteMany(...args),
      findMany: (...args: unknown[]) => conversationFindMany(...args),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

const { DELETE } = await import("@/app/api/conversations/route");

function deleteRequest(body?: unknown) {
  return new NextRequest("http://localhost/api/conversations", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("DELETE /api/conversations", () => {
  beforeEach(() => {
    followUpDeleteMany.mockReset();
    aiDecisionDeleteMany.mockReset();
    messageDeleteMany.mockReset();
    conversationDeleteMany.mockReset();
    transaction.mockReset();
    transaction.mockResolvedValue([]);
  });

  it("deletes all given ids in ONE transaction via deleteMany, not one request per id", async () => {
    const ids = ["conv_1", "conv_2", "conv_3"];
    const res = await DELETE(deleteRequest({ ids }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: true, count: 3 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(followUpDeleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ids } } });
    expect(aiDecisionDeleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ids } } });
    expect(messageDeleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ids } } });
    expect(conversationDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ids } } });
  });

  it("calls deleteMany in FK-safe child-to-parent order (FollowUp, AiDecision, Message, Conversation)", async () => {
    const callOrder: string[] = [];
    followUpDeleteMany.mockImplementation(() => callOrder.push("followUp"));
    aiDecisionDeleteMany.mockImplementation(() => callOrder.push("aiDecision"));
    messageDeleteMany.mockImplementation(() => callOrder.push("message"));
    conversationDeleteMany.mockImplementation(() => callOrder.push("conversation"));

    await DELETE(deleteRequest({ ids: ["conv_1"] }));

    expect(callOrder).toEqual(["followUp", "aiDecision", "message", "conversation"]);
  });

  it("rejects an empty ids array with 400, before touching the database", async () => {
    const res = await DELETE(deleteRequest({ ids: [] }));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a non-array ids field with 400", async () => {
    const res = await DELETE(deleteRequest({ ids: "conv_1" }));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a missing body with 400", async () => {
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects an ids array containing a non-string with 400", async () => {
    const res = await DELETE(deleteRequest({ ids: ["conv_1", 2] }));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
});
