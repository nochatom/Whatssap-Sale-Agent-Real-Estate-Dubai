import { logger, task } from "@trigger.dev/sdk/v3";
import type { CountryCode } from "libphonenumber-js";

import { prisma } from "@/lib/prisma";
import { importLeadsFromCsv, type CsvImportReport } from "@/csv/import";

export interface ProcessCsvPayload {
  csvFileUrl: string;
  campaignId?: string;
  defaultCountry?: string;
}

export interface ProcessCsvResult extends CsvImportReport {
  conversationsCreated: number;
}

/**
 * Creates a Conversation linking each newly-created Lead in a report to a
 * campaign (Conversation is the Lead<->Campaign join — Lead itself has no
 * campaignId column). This is what makes a campaign's leads discoverable by
 * start-campaign afterwards. Only rows with status "created" get a
 * Conversation — a row that matched an existing Lead (duplicate_existing) is
 * NOT auto-enrolled into this campaign, since a lead can already have a
 * Conversation from a different campaign and silently creating a second one
 * would make "which conversation is live" ambiguous. That's a deliberate
 * scope boundary, not an oversight.
 *
 * Extracted so both the Trigger.dev task (URL-based CSV) and the /leads
 * upload UI (in-memory CSV) share the exact same linking behavior.
 */
export async function linkNewLeadsToCampaign(
  report: CsvImportReport,
  campaignId: string,
): Promise<number> {
  const createdLeadIds = report.results
    .filter((r) => r.status === "created" && r.leadId)
    .map((r) => r.leadId as string);

  for (const leadId of createdLeadIds) {
    await prisma.conversation.create({ data: { leadId, campaignId } });
  }

  return createdLeadIds.length;
}

/**
 * Fetches the CSV from csvFileUrl and delegates parsing/normalizing/dedupe/
 * write entirely to importLeadsFromCsv — no import logic duplicated here.
 */
export async function processCsv(payload: ProcessCsvPayload): Promise<ProcessCsvResult> {
  const response = await fetch(payload.csvFileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV from ${payload.csvFileUrl}: ${response.status}`);
  }
  const csvContent = await response.text();

  const report = await importLeadsFromCsv(csvContent, {
    defaultCountry: payload.defaultCountry as CountryCode | undefined,
  });

  const conversationsCreated = payload.campaignId
    ? await linkNewLeadsToCampaign(report, payload.campaignId)
    : 0;

  logger.log("process-csv: import complete", {
    totalRows: report.totalRows,
    created: report.created,
    rejected: report.rejected,
    conversationsCreated,
  });

  return { ...report, conversationsCreated };
}

/**
 * Queue: concurrencyLimit 5 — CSV imports are independent of each other and of
 * any shared external resource, so a handful can run in parallel safely.
 * No concurrencyKey needed at call sites.
 */
export const processCsvTask = task({
  id: "process-csv",
  queue: { concurrencyLimit: 5 },
  retry: { maxAttempts: 3 },
  run: async (payload: ProcessCsvPayload, { ctx }) => {
    logger.log("process-csv received", { payload, ctx });
    return processCsv(payload);
  },
});
