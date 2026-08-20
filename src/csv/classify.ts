import { parse } from "csv-parse/sync";
import type { CountryCode } from "libphonenumber-js";

import { normalizePhoneToE164 } from "./phone";

interface CsvRow {
  phone?: string;
  name?: string;
}

export type CsvRowClassification =
  | { row: number; phoneRaw: string; name: string | null; status: "invalid_phone"; detail?: string }
  | { row: number; phoneRaw: string; name: string | null; status: "duplicate_in_file"; e164: string }
  | { row: number; phoneRaw: string; name: string | null; status: "candidate"; e164: string };

export interface CsvClassificationResult {
  totalRows: number;
  rows: CsvRowClassification[];
}

/**
 * Parses a leads CSV and normalizes/dedupes phone numbers within the file —
 * the part of row classification shared identically between the /leads
 * import preview (which stops here, never touching the DB) and the real
 * import (which takes these candidates on to a DB-existence check and
 * write). Extracted so the parsing/normalization/in-file-dedupe rules can't
 * silently drift between what a preview shows and what an import actually
 * does with the same file.
 *
 * "candidate" means valid and not a duplicate within this file — it says
 * nothing about whether the number already exists in the database, since
 * that requires a DB read this function deliberately never does.
 */
export function classifyCsvRows(csvContent: string, defaultCountry?: CountryCode): CsvClassificationResult {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  const seenInFile = new Set<string>();

  const rows = records.map((row, i): CsvRowClassification => {
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const phoneRaw = row.phone ?? "";
    const name = row.name ?? null;
    const normalized = normalizePhoneToE164(phoneRaw, defaultCountry);

    if (!normalized.ok || !normalized.e164) {
      return { row: rowNumber, phoneRaw, name, status: "invalid_phone", detail: normalized.reason };
    }
    if (seenInFile.has(normalized.e164)) {
      return { row: rowNumber, phoneRaw, name, status: "duplicate_in_file", e164: normalized.e164 };
    }
    seenInFile.add(normalized.e164);
    return { row: rowNumber, phoneRaw, name, status: "candidate", e164: normalized.e164 };
  });

  return { totalRows: records.length, rows };
}
