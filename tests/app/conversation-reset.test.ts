import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
const create = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
      create: (...args: unknown[]) => create(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

const { POST } = await import("@/app/api/conversations/[id]/reset/route");

function makeRequest() {
  return new Request("http://localhost/api/conversations/conv_1/reset", { method: "POST" }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/conversations/[id]/reset", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    create.mockReset();
    transaction.mockReset();
  });

  it("404s when the conversation doesn't exist", async () => {
    findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "conv_missing" }) });
    expect(res.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("archives the old conversation and creates a new empty one carrying leadId/senderPhoneNumberId only", async () => {
    findUnique.mockResolvedValue({
      id: "conv_1",
      leadId: "lead_1",
      campaignId: "camp_1",
      senderPhoneNumberId: "999888777",
      archivedAt: null,
    });
    transaction.mockImplementation(async (ops: unknown[]) => [
      { id: "conv_1", archivedAt: new Date() },
      { id: "conv_new" },
    ]);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "conv_1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ oldConversationId: "conv_1", newConversation: { id: "conv_new" } });

    // The old conversation is archived, never deleted — only archivedAt
    // changes, and campaignId/senderPhoneNumberId/messages are untouched.
    expect(update).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { archivedAt: expect.any(Date) },
    });

    // The new conversation starts genuinely fresh — no campaignId carried
    // over, no history, only the lead and the WhatsApp sender number.
    expect(create).toHaveBeenCalledWith({
      data: { leadId: "lead_1", senderPhoneNumberId: "999888777" },
    });
  });

  it("preserves the original archive timestamp when resetting an already-archived conversation", async () => {
    const originalArchivedAt = new Date("2026-01-01T00:00:00.000Z");
    findUnique.mockResolvedValue({
      id: "conv_1",
      leadId: "lead_1",
      campaignId: null,
      senderPhoneNumberId: "999888777",
      archivedAt: originalArchivedAt,
    });
    transaction.mockImplementation(async () => [{ id: "conv_1" }, { id: "conv_new" }]);

    await POST(makeRequest(), { params: Promise.resolve({ id: "conv_1" }) });

    expect(update).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { archivedAt: originalArchivedAt },
    });
  });
});
