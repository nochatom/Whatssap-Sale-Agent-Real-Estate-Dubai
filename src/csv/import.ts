import type { CountryCode } from "libphonenumber-js";

import { prisma } from "@/lib/prisma";
import { classifyCsvRows } from "./classify";

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

export interface ImportLeadsFromCsvOptions {
  defaultCountry?: CountryCode;
}

interface Candidate {
  rowNumber: number;
  phoneRaw: string;
  e164: string;
  name?: string;
}

/**
 * Parses a leads CSV (expects a `phone` column, optional `name`), normalizes
 * phone numbers to E.164, rejects invalid ones, dedupes within the file and
 * against existing leads, writes valid new leads to the database, and
 * returns a per-row report.
 *
 * Batched rather than one findUnique/create per row (a 2,000-row file used
 * to mean up to 4,000 serial DB round-trips): one findMany resolves which
 * candidates already exist, one createMany writes every genuinely new lead,
 * and one findMany recovers the ids createMany doesn't return — a fixed
 * ~3 queries regardless of file size, with results reassembled in original
 * row order so the report shape is unchanged.
 */
export async function importLeadsFromCsv(
  csvContent: string,
  options: ImportLeadsFromCsvOptions = {},
): Promise<CsvImportReport> {
  // Parsing, phone normalization, and in-file dedup are shared with the
  // /leads import preview (classifyCsvRows) — invalid_phone and
  // duplicate_in_file are decidable from the file alone. Everything else is
  // a candidate needing a DB lookup, left as a null placeholder to be filled
  // in by row index once that lookup comes back.
  const { totalRows, rows } = classifyCsvRows(csvContent, options.defaultCountry);

  const results: (CsvImportRowResult | null)[] = [];
  const candidates: Candidate[] = [];

  for (const row of rows) {
    if (row.status === "invalid_phone") {
      results.push({ row: row.row, phoneRaw: row.phoneRaw, status: "invalid_phone", detail: row.detail });
    } else if (row.status === "duplicate_in_file") {
      results.push({ row: row.row, phoneRaw: row.phoneRaw, status: "duplicate_in_file" });
    } else {
      results.push(null);
      candidates.push({ rowNumber: row.row, phoneRaw: row.phoneRaw, e164: row.e164, name: row.name || undefined });
    }
  }

  // Pass 2: one batched lookup for which candidates already exist.
  const existingLeads = candidates.length
    ? await prisma.lead.findMany({
        where: { phoneE164: { in: candidates.map((c) => c.e164) } },
        select: { id: true, phoneE164: true },
      })
    : [];
  const existingByE164 = new Map(existingLeads.map((l) => [l.phoneE164, l.id]));

  // CSV-imported leads are the operator's own sourced contacts — treated as
  // opted-in for direct outreach. Suppression (checkSuppression) is the
  // separate, still-active mechanism for anyone who later opts out.
  const toCreate = candidates.filter((c) => !existingByE164.has(c.e164));

  // Pass 3: one batched insert for every genuinely new lead. skipDuplicates
  // guards a race (another import inserting the same number between pass 2
  // and here) without letting one colliding row fail the whole batch — the
  // per-row create() this replaced only ever risked one row on that race,
  // so a batch insert needs the same "one bad row can't sink the rest"
  // property, not just the same happy-path result.
  if (toCreate.length > 0) {
    await prisma.lead.createMany({
      data: toCreate.map((c) => ({ phoneE164: c.e164, name: c.name, optedIn: true })),
      skipDuplicates: true,
    });
  }

  // createMany doesn't return the created rows, so recover their ids with
  // one more batched lookup.
  const createdLeads = toCreate.length
    ? await prisma.lead.findMany({
        where: { phoneE164: { in: toCreate.map((c) => c.e164) } },
        select: { id: true, phoneE164: true },
      })
    : [];
  const createdByE164 = new Map(createdLeads.map((l) => [l.phoneE164, l.id]));

  // Pass 4: fill in the placeholders, preserving original row order. Every
  // null placeholder has exactly one corresponding candidate in the same
  // relative order they were pushed in pass 1, so this index is always in
  // bounds — the guard exists only to satisfy noUncheckedIndexedAccess.
  let candidateIndex = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i] !== null) continue;
    const c = candidates[candidateIndex++];
    if (!c) continue;
    const existingId = existingByE164.get(c.e164);
    results[i] = existingId
      ? { row: c.rowNumber, phoneRaw: c.phoneRaw, status: "duplicate_existing", leadId: existingId }
      : { row: c.rowNumber, phoneRaw: c.phoneRaw, status: "created", leadId: createdByE164.get(c.e164) };
  }

  const finalResults = results as CsvImportRowResult[];

  return {
    totalRows,
    created: finalResults.filter((r) => r.status === "created").length,
    rejected: finalResults.filter((r) => r.status !== "created").length,
    results: finalResults,
  };
}
