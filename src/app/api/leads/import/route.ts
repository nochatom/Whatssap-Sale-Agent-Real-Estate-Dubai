import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import type { CountryCode } from "libphonenumber-js";

import { normalizePhoneToE164 } from "@/csv/phone";
import { importLeadsFromCsv } from "@/csv/import";
import { linkNewLeadsToCampaign } from "@trigger/process-csv";

interface CsvRow {
  phone?: string;
  name?: string;
}

interface ImportRequestBody {
  csvContent: string;
  campaignId?: string;
  defaultCountry?: string;
  confirm?: boolean;
}

/**
 * Preview-only row classification — parses and validates phone numbers via
 * the existing normalizePhoneToE164, but never touches the database. Cannot
 * reuse importLeadsFromCsv directly for this: that function parses, dedupes
 * against the DB, and writes in one pass, with no dry-run mode. Adding one
 * would mean changing existing, tested, working code, which was ruled out.
 * This intentionally does NOT check duplicate_existing (that requires a DB
 * read) — only invalid_phone and duplicate_in_file are shown at preview
 * time; the real duplicate_existing check happens for real on confirm,
 * inside the unchanged importLeadsFromCsv.
 */
function previewCsv(csvContent: string, defaultCountry?: CountryCode) {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  const seenInFile = new Set<string>();

  const rows = records.map((row, i) => {
    const rowNumber = i + 2;
    const phoneRaw = row.phone ?? "";
    const name = row.name ?? null;
    const normalized = normalizePhoneToE164(phoneRaw, defaultCountry);

    if (!normalized.ok || !normalized.e164) {
      return { row: rowNumber, phoneRaw, name, status: "invalid_phone" as const, detail: normalized.reason };
    }
    if (seenInFile.has(normalized.e164)) {
      return { row: rowNumber, phoneRaw, name, status: "duplicate_in_file" as const, e164: normalized.e164 };
    }
    seenInFile.add(normalized.e164);
    return { row: rowNumber, phoneRaw, name, status: "ok" as const, e164: normalized.e164 };
  });

  return { totalRows: records.length, rows };
}

export async function POST(request: NextRequest) {
  let body: ImportRequestBody;
  try {
    body = (await request.json()) as ImportRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.csvContent) {
    return NextResponse.json({ error: "csvContent is required" }, { status: 400 });
  }

  const defaultCountry = body.defaultCountry as CountryCode | undefined;

  if (!body.confirm) {
    const preview = previewCsv(body.csvContent, defaultCountry);
    return NextResponse.json({ mode: "preview", ...preview });
  }

  const report = await importLeadsFromCsv(body.csvContent, { defaultCountry });
  const conversationsCreated = body.campaignId
    ? await linkNewLeadsToCampaign(report, body.campaignId)
    : 0;

  return NextResponse.json({ mode: "imported", ...report, conversationsCreated });
}
