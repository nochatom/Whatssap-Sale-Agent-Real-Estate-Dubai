import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: (...args: unknown[]) => create(...args),
    },
  },
}));

import { importLeadsFromCsv } from "@/csv/import";

describe("importLeadsFromCsv", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it("creates exactly one lead from a file with a duplicate row and an invalid phone, naming both rejections", async () => {
    findUnique.mockResolvedValue(null); // no pre-existing leads
    let nextId = 1;
    create.mockImplementation(async ({ data }: { data: { phoneE164: string } }) => ({
      id: `lead_${nextId++}`,
      phoneE164: data.phoneE164,
    }));

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
    expect(create).toHaveBeenCalledTimes(1);

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
    findUnique.mockResolvedValue({ id: "existing_lead", phoneE164: "+971501234567" });

    const csv = ["phone,name", "+971 50 123 4567,Alice"].join("\n");
    const report = await importLeadsFromCsv(csv);

    expect(report.created).toBe(0);
    expect(report.results[0].status).toBe("duplicate_existing");
    expect(report.results[0].leadId).toBe("existing_lead");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an empty report for a file with only a header row", async () => {
    findUnique.mockResolvedValue(null);
    const report = await importLeadsFromCsv("phone,name\n");
    expect(report.totalRows).toBe(0);
    expect(report.created).toBe(0);
    expect(report.rejected).toBe(0);
  });
});
