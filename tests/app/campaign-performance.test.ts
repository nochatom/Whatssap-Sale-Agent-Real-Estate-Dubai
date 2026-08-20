import { beforeEach, describe, expect, it, vi } from "vitest";

const campaignFindMany = vi.fn();
const conversationFindMany = vi.fn();
const messageGroupBy = vi.fn();
const followUpGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findMany: (...args: unknown[]) => campaignFindMany(...args) },
    conversation: { findMany: (...args: unknown[]) => conversationFindMany(...args) },
    message: { groupBy: (...args: unknown[]) => messageGroupBy(...args) },
    followUp: { groupBy: (...args: unknown[]) => followUpGroupBy(...args) },
  },
}));

const { getCampaignPerformance } = await import("@/app/_lib/campaign-performance");

describe("getCampaignPerformance", () => {
  beforeEach(() => {
    campaignFindMany.mockReset();
    conversationFindMany.mockReset();
    messageGroupBy.mockReset();
    followUpGroupBy.mockReset();
  });

  it("returns an empty array without querying anything else when there are no campaigns", async () => {
    campaignFindMany.mockResolvedValue([]);

    const result = await getCampaignPerformance();

    expect(result).toEqual([]);
    expect(conversationFindMany).not.toHaveBeenCalled();
    expect(messageGroupBy).not.toHaveBeenCalled();
    expect(followUpGroupBy).not.toHaveBeenCalled();
  });

  it("rolls up per-conversation counts to per-campaign totals correctly", async () => {
    campaignFindMany.mockResolvedValue([
      { id: "camp_1", name: "Campaign One", status: "ACTIVE" },
      { id: "camp_2", name: "Campaign Two", status: "DRAFT" },
    ]);
    // camp_1 has 2 conversations (conv_1, conv_2), camp_2 has 1 (conv_3), and
    // conv_4 belongs to neither campaign in this result set (defensive case).
    conversationFindMany.mockResolvedValue([
      { id: "conv_1", campaignId: "camp_1" },
      { id: "conv_2", campaignId: "camp_1" },
      { id: "conv_3", campaignId: "camp_2" },
    ]);
    messageGroupBy.mockResolvedValue([
      { conversationId: "conv_1", direction: "OUTBOUND", _count: { _all: 3 } },
      { conversationId: "conv_1", direction: "INBOUND", _count: { _all: 2 } },
      { conversationId: "conv_2", direction: "OUTBOUND", _count: { _all: 1 } },
      // conv_2 has no INBOUND rows at all (never replied) — must not crash
      // and must not count toward replies.
      { conversationId: "conv_3", direction: "INBOUND", _count: { _all: 5 } },
      // conv_3 has inbound but zero outbound — must NOT count as "contacted".
    ]);
    followUpGroupBy.mockResolvedValue([
      { conversationId: "conv_1", _count: { _all: 1 } },
      { conversationId: "conv_3", _count: { _all: 2 } },
    ]);

    const result = await getCampaignPerformance();

    expect(result).toEqual([
      {
        id: "camp_1",
        name: "Campaign One",
        status: "ACTIVE",
        leads: 2,
        sent: 4, // 3 (conv_1) + 1 (conv_2)
        replies: 2, // conv_1 only
        followUps: 1,
        progress: 100, // both conv_1 and conv_2 have at least one outbound message
      },
      {
        id: "camp_2",
        name: "Campaign Two",
        status: "DRAFT",
        leads: 1,
        sent: 0,
        replies: 5,
        followUps: 2,
        progress: 0, // conv_3 has replies but no outbound, so 0 contacted
      },
    ]);

    // Batched: exactly one query per model, not one per campaign.
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
    expect(messageGroupBy).toHaveBeenCalledTimes(1);
    expect(followUpGroupBy).toHaveBeenCalledTimes(1);
  });

  it("defaults every metric to 0 for a campaign with no conversations at all", async () => {
    campaignFindMany.mockResolvedValue([{ id: "camp_empty", name: "Empty", status: "DRAFT" }]);
    conversationFindMany.mockResolvedValue([]);
    messageGroupBy.mockResolvedValue([]);
    followUpGroupBy.mockResolvedValue([]);

    const result = await getCampaignPerformance();

    expect(result).toEqual([
      { id: "camp_empty", name: "Empty", status: "DRAFT", leads: 0, sent: 0, replies: 0, followUps: 0, progress: 0 },
    ]);
    // No conversations => no reason to query messages/follow-ups at all.
    expect(messageGroupBy).not.toHaveBeenCalled();
    expect(followUpGroupBy).not.toHaveBeenCalled();
  });
});
