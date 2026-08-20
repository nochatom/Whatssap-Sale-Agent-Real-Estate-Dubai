import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importLeadsFromCsvMock = vi.fn();
vi.mock("@/csv/import", () => ({
  importLeadsFromCsv: (...args: unknown[]) => importLeadsFromCsvMock(...args),
}));

const conversationCreateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { createMany: (...args: unknown[]) => conversationCreateMany(...args) },
  },
}));

const { processCsv } = await import("@trigger/process-csv");

describe("processCsv", () => {
  beforeEach(() => {
    importLeadsFromCsvMock.mockReset();
    conversationCreateMany.mockReset().mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the CSV and delegates parsing entirely to importLeadsFromCsv", async () => {
    const csvText = "phone,name\n+15551234567,Jane\n";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => csvText,
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = {
      totalRows: 1,
      created: 1,
      rejected: 0,
      results: [{ row: 2, phoneRaw: "+15551234567", status: "created", leadId: "lead_1" }],
    };
    importLeadsFromCsvMock.mockResolvedValue(report);

    const result = await processCsv({
      csvFileUrl: "https://example.com/leads.csv",
      defaultCountry: "AE",
    });

    expect(result).toEqual({ ...report, conversationsCreated: 0 });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/leads.csv");
    expect(importLeadsFromCsvMock).toHaveBeenCalledWith(csvText, { defaultCountry: "AE" });
    expect(conversationCreateMany).not.toHaveBeenCalled();
  });

  it("throws without calling importLeadsFromCsv when the fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      processCsv({ csvFileUrl: "https://example.com/missing.csv" }),
    ).rejects.toThrow(/404/);

    expect(importLeadsFromCsvMock).not.toHaveBeenCalled();
  });

  it("creates a Conversation for each newly-created lead when campaignId is given", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "phone\n" }));

    importLeadsFromCsvMock.mockResolvedValue({
      totalRows: 3,
      created: 2,
      rejected: 1,
      results: [
        { row: 2, phoneRaw: "+1", status: "created", leadId: "lead_1" },
        { row: 3, phoneRaw: "+1", status: "duplicate_in_file" },
        { row: 4, phoneRaw: "+2", status: "created", leadId: "lead_2" },
      ],
    });

    const result = await processCsv({
      csvFileUrl: "https://example.com/leads.csv",
      campaignId: "camp_1",
    });

    expect(result.conversationsCreated).toBe(2);
    expect(conversationCreateMany).toHaveBeenCalledTimes(1);
    expect(conversationCreateMany).toHaveBeenCalledWith({
      data: [
        { leadId: "lead_1", campaignId: "camp_1" },
        { leadId: "lead_2", campaignId: "camp_1" },
      ],
    });
  });

  it("does not create a Conversation for a row that matched an existing lead", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "phone\n" }));

    importLeadsFromCsvMock.mockResolvedValue({
      totalRows: 1,
      created: 0,
      rejected: 1,
      results: [{ row: 2, phoneRaw: "+1", status: "duplicate_existing", leadId: "lead_existing" }],
    });

    const result = await processCsv({
      csvFileUrl: "https://example.com/leads.csv",
      campaignId: "camp_1",
    });

    expect(result.conversationsCreated).toBe(0);
    expect(conversationCreateMany).not.toHaveBeenCalled();
  });
});
