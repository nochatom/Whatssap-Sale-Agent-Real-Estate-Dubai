import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const campaignFindUniqueOrThrow = vi.fn();
const campaignUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findUniqueOrThrow: (...args: unknown[]) => campaignFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => campaignUpdate(...args),
    },
  },
}));

const fetchMetaTemplateStatusMock = vi.fn();
vi.mock("@/whatsapp/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/whatsapp/templates")>();
  return {
    ...actual,
    fetchMetaTemplateStatus: (...args: unknown[]) => fetchMetaTemplateStatusMock(...args),
  };
});

const { POST } = await import("@/app/api/campaigns/[id]/sync-template/route");

function req() {
  return new NextRequest("http://localhost/api/campaigns/camp_1/sync-template", { method: "POST" });
}

describe("POST /api/campaigns/[id]/sync-template", () => {
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;

  beforeEach(() => {
    campaignFindUniqueOrThrow.mockReset().mockResolvedValue({
      id: "camp_1",
      templateName: "property_video_intro_v1 · English",
      templateStatus: "PENDING",
    });
    campaignUpdate.mockReset().mockResolvedValue({
      id: "camp_1",
      templateName: "property_video_intro_v1",
      templateStatus: "APPROVED",
    });
    fetchMetaTemplateStatusMock.mockReset();
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
  });

  it("corrects templateName and templateStatus from Meta's real status", async () => {
    fetchMetaTemplateStatusMock.mockResolvedValue({
      name: "property_video_intro_v1",
      status: "APPROVED",
      language: "en",
    });

    const res = await POST(req(), { params: Promise.resolve({ id: "camp_1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { templateName: "property_video_intro_v1", templateStatus: "APPROVED" },
    });
    expect(body.metaStatus).toBe("APPROVED");
  });

  it("maps a REJECTED Meta status onto the enum's REJECTED value", async () => {
    fetchMetaTemplateStatusMock.mockResolvedValue({
      name: "property_video_intro_v1",
      status: "REJECTED",
      language: "en",
    });

    await POST(req(), { params: Promise.resolve({ id: "camp_1" }) });

    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { templateName: "property_video_intro_v1", templateStatus: "REJECTED" },
    });
  });

  it("maps an unrecognized Meta status (e.g. DISABLED) onto PENDING rather than inventing a new enum value", async () => {
    fetchMetaTemplateStatusMock.mockResolvedValue({
      name: "property_video_intro_v1",
      status: "DISABLED",
      language: "en",
    });

    await POST(req(), { params: Promise.resolve({ id: "camp_1" }) });

    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: "camp_1" },
      data: { templateName: "property_video_intro_v1", templateStatus: "PENDING" },
    });
  });

  it("404s when no matching template exists on Meta, without updating the campaign", async () => {
    fetchMetaTemplateStatusMock.mockResolvedValue(null);

    const res = await POST(req(), { params: Promise.resolve({ id: "camp_1" }) });

    expect(res.status).toBe(404);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("returns 502 when the Meta lookup itself fails, without updating the campaign", async () => {
    fetchMetaTemplateStatusMock.mockRejectedValue(new Error("Meta template lookup failed (HTTP 401): bad token"));

    const res = await POST(req(), { params: Promise.resolve({ id: "camp_1" }) });

    expect(res.status).toBe(502);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 without calling Meta when WHATSAPP_ACCESS_TOKEN is unset", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    const res = await POST(req(), { params: Promise.resolve({ id: "camp_1" }) });

    expect(res.status).toBe(500);
    expect(fetchMetaTemplateStatusMock).not.toHaveBeenCalled();
  });

  it("404s when the campaign itself doesn't exist", async () => {
    const { Prisma } = await import("@prisma/client");
    campaignFindUniqueOrThrow.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "6.19.2" }),
    );

    const res = await POST(req(), { params: Promise.resolve({ id: "camp_missing" }) });

    expect(res.status).toBe(404);
  });
});
