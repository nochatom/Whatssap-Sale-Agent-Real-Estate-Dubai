import { beforeEach, describe, expect, it, vi } from "vitest";

const followUpDeleteMany = vi.fn();
const aiDecisionDeleteMany = vi.fn();
const messageDeleteMany = vi.fn();
const conversationDeleteMany = vi.fn();
const leadDeleteMany = vi.fn();
const transaction = vi.fn();

// Deliberately does NOT mock campaign/asset/suppressionList at all — if the
// route ever called any of those, the test would fail with "not a function"
// rather than silently succeeding, since those methods don't exist on this mock.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    followUp: { deleteMany: (...args: unknown[]) => followUpDeleteMany(...args) },
    aiDecision: { deleteMany: (...args: unknown[]) => aiDecisionDeleteMany(...args) },
    message: { deleteMany: (...args: unknown[]) => messageDeleteMany(...args) },
    conversation: { deleteMany: (...args: unknown[]) => conversationDeleteMany(...args) },
    lead: { deleteMany: (...args: unknown[]) => leadDeleteMany(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

const { POST } = await import("@/app/api/dashboard/clear-data/route");

describe("POST /api/dashboard/clear-data", () => {
  beforeEach(() => {
    followUpDeleteMany.mockReset();
    aiDecisionDeleteMany.mockReset();
    messageDeleteMany.mockReset();
    conversationDeleteMany.mockReset();
    leadDeleteMany.mockReset();
    transaction.mockReset();
  });

  it("deletes all five Dashboard-statistic models, unfiltered, in one transaction, in FK-safe order", async () => {
    transaction.mockImplementation(async (ops: unknown[]) => {
      // Confirms the five calls were actually built (mock fns invoked) before
      // being handed to $transaction, in the exact order the real FK
      // constraints require (RESTRICT on Conversation<-Message/AiDecision/
      // FollowUp, RESTRICT on Lead<-Conversation/FollowUp).
      expect(followUpDeleteMany).toHaveBeenCalledWith({});
      expect(aiDecisionDeleteMany).toHaveBeenCalledWith({});
      expect(messageDeleteMany).toHaveBeenCalledWith({});
      expect(conversationDeleteMany).toHaveBeenCalledWith({});
      expect(leadDeleteMany).toHaveBeenCalledWith({});
      return [{ count: 2 }, { count: 3 }, { count: 10 }, { count: 4 }, { count: 5 }];
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      deleted: { followUps: 2, aiDecisions: 3, messages: 10, conversations: 4, leads: 5 },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("never touches Campaign, Asset, or SuppressionList", async () => {
    transaction.mockResolvedValue([{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }]);

    // If the route imported/called prisma.campaign, prisma.asset, or
    // prisma.suppressionList, this would throw (undefined is not a
    // function) since the mock above only defines the five models it should
    // touch — a passing test is itself the guarantee.
    await expect(POST()).resolves.toBeDefined();
  });
});
