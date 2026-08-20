import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const createMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findMany: (...args: unknown[]) => findMany(...args),
      createMany: (...args: unknown[]) => createMany(...args),
    },
  },
}));

import { importLeadsFromCsv } from "@/csv/import";

describe("importLeadsFromCsv", () => {
  beforeEach(() => {
    findMany.mockReset();
    createMany.mockReset();
  });

  it("creates exactly one lead from a file with a duplicate row and an invalid phone, naming both rejections", async () => {
    findMany
      .mockResolvedValueOnce([]) // pass 2: nothing pre-existing
      .mockResolvedValueOnce([{ id: "lead_1", phoneE164: "+971501234567" }]); // pass 3: recover created id
    createMany.mockResolvedValue({ count: 1 });

    const csv = [
      "phone,name",
      "+971 50 123 4567,Alice",
      "+971 50 123 4567,Alice Again",
      "not-a-phone,Bob",
    ].join("\n");

    const report = await importLeadsFromCsv(csv);

    expect(report.totalRows).toBe(3);
    expect(report.created).toBe(1);
    expect(report.rejected).toBe(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ phoneE164: "+971501234567", name: "Alice", optedIn: true }],
      skipDuplicates: true,
    });

    const duplicateResult = report.results.find((r) => r.row === 3);
    expect(duplicateResult?.status).toBe("duplicate_in_file");

    const invalidResult = report.results.find((r) => r.row === 4);
    expect(invalidResult?.status).toBe("invalid_phone");
    expect(invalidResult?.detail).toBeDefined();

    const createdResult = report.results.find((r) => r.row === 2);
    expect(createdResult?.status).toBe("created");
    expect(createdResult?.leadId).toBe("lead_1");
  });

  it("rejects a row whose phone already exists in the database", async () => {
    findMany.mockResolvedValueOnce([{ id: "existing_lead", phoneE164: "+971501234567" }]);

    const csv = ["phone,name", "+971 50 123 4567,Alice"].join("\n");
    const report = await importLeadsFromCsv(csv);

    expect(report.created).toBe(0);
    expect(report.results[0].status).toBe("duplicate_existing");
    expect(report.results[0].leadId).toBe("existing_lead");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("returns an empty report for a file with only a header row", async () => {
    const report = await importLeadsFromCsv("phone,name\n");
    expect(report.totalRows).toBe(0);
    expect(report.created).toBe(0);
    expect(report.rejected).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
