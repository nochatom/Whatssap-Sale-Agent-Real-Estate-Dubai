import { parse } from "csv-parse/sync";
import type { CountryCode } from "libphonenumber-js";

import { prisma } from "@/lib/prisma";
import { normalizePhoneToE164 } from "./phone";

export type CsvImportRowStatus =
  | "created"
  | "duplicate_in_file"
  | "duplicate_existing"
  | "invalid_phone";

export interface CsvImportRowResult {
  row: number;
  phoneRaw: string;
  status: CsvImportRowStatus;
  detail?: string;
  leadId?: string;
}

export interface CsvImportReport {
  totalRows: number;
  created: number;
  rejected: number;
  results: CsvImportRowResult[];
}

interface CsvRow {
  phone?: string;
  name?: string;
}

export interface ImportLeadsFromCsvOptions {
  defaultCountry?: CountryCode;
}

/**
 * Parses a leads CSV (expects a `phone` column, optional `name`), normalizes
 * phone numbers to E.164, rejects invalid ones, dedupes within the file and
 * against existing leads, writes valid new leads to the database, and
 * returns a per-row report.
 */
export async function importLeadsFromCsv(
  csvContent: string,
  options: ImportLeadsFromCsvOptions = {},
): Promise<CsvImportReport> {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  const results: CsvImportRowResult[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const phoneRaw = row.phone ?? "";

    const normalized = normalizePhoneToE164(phoneRaw, options.defaultCountry);
    if (!normalized.ok || !normalized.e164) {
      results.push({
        row: rowNumber,
        phoneRaw,
        status: "invalid_phone",
        detail: normalized.reason,
      });
      continue;
    }

    const e164 = normalized.e164;

    if (seenInFile.has(e164)) {
      results.push({ row: rowNumber, phoneRaw, status: "duplicate_in_file" });
      continue;
    }
    seenInFile.add(e164);

    const existing = await prisma.lead.findUnique({ where: { phoneE164: e164 } });
    if (existing) {
      results.push({
        row: rowNumber,
        phoneRaw,
        status: "duplicate_existing",
        leadId: existing.id,
      });
      continue;
    }

    const created = await prisma.lead.create({
      data: { phoneE164: e164, name: row.name || undefined },
    });
    results.push({ row: rowNumber, phoneRaw, status: "created", leadId: created.id });
  }

  return {
    totalRows: records.length,
    created: results.filter((r) => r.status === "created").length,
    rejected: results.filter((r) => r.status !== "created").length,
    results,
  };
}
