import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const campaignUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      update: (...args: unknown[]) => campaignUpdate(...args),
    },
  },
}));

const { PATCH } = await import("@/app/api/campaigns/[id]/route");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/campaigns/camp_1", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PATCH>[0];
}

function makeInvalidJsonRequest() {
  return new Request("http://localhost/api/campaigns/camp_1", {
    method: "PATCH",
    body: "not json",
  }) as unknown as Parameters<typeof PATCH>[0];
}

describe("PATCH /api/campaigns/[id]", () => {
  beforeEach(() => {
    campaignUpdate.mockReset();
  });

  it("enables follow-up and returns the updated campaign", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true });

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true }), {
      params: Promise.resolve({ id: "camp_1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ campaign: { id: "camp_1", campaignFollowUpEnabled: true } });
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true },
    });
  });

  it("disables follow-up", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: false });

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: false }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(200);
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: false },
    });
  });

  it("400s when campaignFollowUpEnabled is missing", async () => {
    const res = await PATCH(makeRequest({}), { params: Promise.resolve({ id: "camp_1" }) });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("400s when campaignFollowUpEnabled is not a boolean", async () => {
    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: "yes" }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("accepts followUpDelayMinutes alongside the required toggle and persists both", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true, followUpDelayMinutes: 2880 });

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, followUpDelayMinutes: 2880 }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(200);
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true, followUpDelayMinutes: 2880 },
    });
  });

  it("omits followUpDelayMinutes from the update when the caller doesn't send it (leaves it untouched)", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true });

    await PATCH(makeRequest({ campaignFollowUpEnabled: true }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true },
    });
  });

  it("accepts a null followUpDelayMinutes to clear it", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true, followUpDelayMinutes: null });

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, followUpDelayMinutes: null }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(200);
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true, followUpDelayMinutes: null },
    });
  });

  it("400s when followUpDelayMinutes is zero", async () => {
    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, followUpDelayMinutes: 0 }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("400s when followUpDelayMinutes is negative", async () => {
    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, followUpDelayMinutes: -5 }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("400s when followUpDelayMinutes is not an integer", async () => {
    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, followUpDelayMinutes: 12.5 }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("400s when followUpDelayMinutes is not a number or null", async () => {
    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, followUpDelayMinutes: "2880" }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("accepts status alongside the required toggle and activates a DRAFT campaign", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true, status: "ACTIVE" });

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, status: "ACTIVE" }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(200);
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true, status: "ACTIVE" },
    });
  });

  it("omits status from the update when the caller doesn't send it (leaves it untouched)", async () => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true });

    await PATCH(makeRequest({ campaignFollowUpEnabled: true }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true },
    });
  });

  it("400s when status is not a recognized CampaignStatus value", async () => {
    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, status: "LIVE" }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"])("accepts status=%s", async (status) => {
    campaignUpdate.mockResolvedValue({ id: "camp_1", campaignFollowUpEnabled: true, status });

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true, status }), {
      params: Promise.resolve({ id: "camp_1" }),
    });

    expect(res.status).toBe(200);
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { campaignFollowUpEnabled: true, status },
    });
  });

  it("400s on invalid JSON", async () => {
    const res = await PATCH(makeInvalidJsonRequest(), { params: Promise.resolve({ id: "camp_1" }) });

    expect(res.status).toBe(400);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("404s when the campaign doesn't exist", async () => {
    campaignUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "6.19.2" }),
    );

    const res = await PATCH(makeRequest({ campaignFollowUpEnabled: true }), {
      params: Promise.resolve({ id: "camp_missing" }),
    });

    expect(res.status).toBe(404);
  });
});
