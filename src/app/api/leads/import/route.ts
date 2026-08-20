import { NextRequest, NextResponse } from "next/server";
import type { CountryCode } from "libphonenumber-js";

import { classifyCsvRows } from "@/csv/classify";
import { importLeadsFromCsv } from "@/csv/import";
import { linkNewLeadsToCampaign } from "@trigger/process-csv";

interface ImportRequestBody {
  csvContent: string;
  campaignId?: string;
  defaultCountry?: string;
  confirm?: boolean;
}

/**
 * Preview-only row classification, built on the same classifyCsvRows used
 * by the real import — parsing, phone normalization, and in-file dedup
 * can't drift between what a preview shows and what a confirmed import
 * does with the same file. Never touches the database: this intentionally
 * does NOT check duplicate_existing (that requires a DB read) — only
 * invalid_phone and duplicate_in_file are shown at preview time; the real
 * duplicate_existing check happens for real on confirm, inside the
 * unchanged importLeadsFromCsv.
 */
function previewCsv(csvContent: string, defaultCountry?: CountryCode) {
  const { totalRows, rows } = classifyCsvRows(csvContent, defaultCountry);
  return {
    totalRows,
    rows: rows.map((r) =>
      r.status === "candidate"
        ? { row: r.row, phoneRaw: r.phoneRaw, name: r.name, status: "ok" as const, e164: r.e164 }
        : r,
    ),
  };
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
