import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const followUpDeleteMany = vi.fn();
const aiDecisionDeleteMany = vi.fn();
const messageDeleteMany = vi.fn();
const assetDeleteMany = vi.fn();
const conversationDeleteMany = vi.fn();
const leadDelete = vi.fn();
const leadDeleteMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    followUp: { deleteMany: (...args: unknown[]) => followUpDeleteMany(...args) },
    aiDecision: { deleteMany: (...args: unknown[]) => aiDecisionDeleteMany(...args) },
    message: { deleteMany: (...args: unknown[]) => messageDeleteMany(...args) },
    asset: { deleteMany: (...args: unknown[]) => assetDeleteMany(...args) },
    conversation: { deleteMany: (...args: unknown[]) => conversationDeleteMany(...args) },
    lead: {
      delete: (...args: unknown[]) => leadDelete(...args),
      deleteMany: (...args: unknown[]) => leadDeleteMany(...args),
      findMany: vi.fn(),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

const { DELETE } = await import("@/app/api/leads/route");

function deleteRequest(opts: { id?: string; body?: unknown }) {
  const url = opts.id
    ? `http://localhost/api/leads?id=${encodeURIComponent(opts.id)}`
    : "http://localhost/api/leads";
  return new NextRequest(url, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe("DELETE /api/leads", () => {
  beforeEach(() => {
    followUpDeleteMany.mockReset();
    aiDecisionDeleteMany.mockReset();
    messageDeleteMany.mockReset();
    assetDeleteMany.mockReset();
    conversationDeleteMany.mockReset();
    leadDelete.mockReset();
    leadDeleteMany.mockReset();
    transaction.mockReset();
    transaction.mockResolvedValue([]);
  });

  it("single ?id= still uses lead.delete() (unchanged behavior) and deletes exactly one lead's history", async () => {
    const res = await DELETE(deleteRequest({ id: "lead_1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: true, count: 1 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(followUpDeleteMany).toHaveBeenCalledWith({ where: { leadId: "lead_1" } });
    expect(leadDelete).toHaveBeenCalledWith({ where: { id: "lead_1" } });
    expect(leadDeleteMany).not.toHaveBeenCalled();
  });

  it("a bulk JSON body deletes all given ids in ONE transaction via deleteMany, not one request per id", async () => {
    const ids = ["lead_1", "lead_2", "lead_3"];
    const res = await DELETE(deleteRequest({ body: { ids } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: true, count: 3 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(followUpDeleteMany).toHaveBeenCalledWith({ where: { leadId: { in: ids } } });
    expect(conversationDeleteMany).toHaveBeenCalledWith({ where: { leadId: { in: ids } } });
    expect(leadDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ids } } });
    expect(leadDelete).not.toHaveBeenCalled();
  });

  it("rejects an empty ids array with 400, before touching the database", async () => {
    const res = await DELETE(deleteRequest({ body: { ids: [] } }));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a non-array ids field with 400", async () => {
    const res = await DELETE(deleteRequest({ body: { ids: "lead_1" } }));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects missing id and missing body with 400", async () => {
    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("404s via P2025 when a single-id delete targets an already-gone lead", async () => {
    const { Prisma } = await import("@prisma/client");
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "6.19.2" }),
    );

    const res = await DELETE(deleteRequest({ id: "lead_missing" }));
    expect(res.status).toBe(404);
  });
});
