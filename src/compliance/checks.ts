import type { Campaign, Conversation, Lead } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type ComplianceFailure =
  | "suppression"
  | "opt_out"
  | "campaign_inactive"
  | "daily_budget_exceeded"
  | "idempotency_conflict"
  | "service_window_closed"
  | "template_not_approved";

export interface ComplianceGateResult {
  passed: boolean;
  failedCheck?: ComplianceFailure;
}

export async function checkSuppression(phoneE164: string): Promise<boolean> {
  const suppressed = await prisma.suppressionList.findUnique({ where: { phoneE164 } });
  return suppressed === null;
}

export function checkOptOutFlag(lead: Pick<Lead, "optedIn">): boolean {
  return lead.optedIn === true;
}

export function checkCampaignActive(campaign: Pick<Campaign, "status">): boolean {
  return campaign.status === "ACTIVE";
}

/**
 * Counts today's outbound messages sent from this campaign's sender number.
 * This read is NOT atomic by itself — it only becomes a real budget gate when
 * the send-outbound Trigger.dev task runs with concurrencyKey: senderPhoneNumberId
 * and queue.concurrencyLimit: 1, which serializes this read-then-send per
 * sender number. See trigger/send-outbound.ts.
 */
export async function checkDailyBudget(
  campaign: Pick<Campaign, "id" | "dailyBudgetPerNumber">,
): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const sentToday = await prisma.message.count({
    where: {
      direction: "OUTBOUND",
      createdAt: { gte: startOfDay },
      conversation: { campaignId: campaign.id },
    },
  });

  return sentToday < campaign.dailyBudgetPerNumber;
}

export async function checkIdempotency(idempotencyKey: string): Promise<boolean> {
  const existing = await prisma.message.findUnique({ where: { idempotencyKey } });
  return existing === null;
}

/**
 * Free-text outbound is only legal inside an open 24-hour customer service
 * window (last inbound message from the lead). Template sends are exempt.
 */
export function checkServiceWindow(
  conversation: Pick<Conversation, "lastInboundAt">,
  isTemplate: boolean,
  now: Date = new Date(),
): boolean {
  if (isTemplate) return true;
  if (!conversation.lastInboundAt) return false;
  const windowMs = 24 * 60 * 60 * 1000;
  return now.getTime() - conversation.lastInboundAt.getTime() < windowMs;
}

/**
 * A template send is only legal against a Meta-approved template. Free-text
 * sends aren't gated by this — they're gated by checkServiceWindow instead.
 */
export function checkTemplateApproval(
  campaign: Pick<Campaign, "templateStatus">,
  isTemplate: boolean,
): boolean {
  if (!isTemplate) return true;
  return campaign.templateStatus === "APPROVED";
}

export interface RunComplianceGateParams {
  phoneE164: string;
  lead: Pick<Lead, "optedIn">;
  campaign: Pick<Campaign, "id" | "status" | "dailyBudgetPerNumber" | "templateStatus">;
  conversation: Pick<Conversation, "lastInboundAt">;
  idempotencyKey: string;
  isTemplate: boolean;
}

/**
 * Aggregates all five compliance gates. Built in Phase 1; nothing calls it
 * yet, since no send path exists until Phase 2.
 */
export async function runComplianceGate(
  params: RunComplianceGateParams,
): Promise<ComplianceGateResult> {
  if (!(await checkSuppression(params.phoneE164))) {
    return { passed: false, failedCheck: "suppression" };
  }
  if (!checkOptOutFlag(params.lead)) {
    return { passed: false, failedCheck: "opt_out" };
  }
  if (!checkCampaignActive(params.campaign)) {
    return { passed: false, failedCheck: "campaign_inactive" };
  }
  if (!(await checkDailyBudget(params.campaign))) {
    return { passed: false, failedCheck: "daily_budget_exceeded" };
  }
  if (!(await checkIdempotency(params.idempotencyKey))) {
    return { passed: false, failedCheck: "idempotency_conflict" };
  }
  if (!checkServiceWindow(params.conversation, params.isTemplate)) {
    return { passed: false, failedCheck: "service_window_closed" };
  }
  if (!checkTemplateApproval(params.campaign, params.isTemplate)) {
    return { passed: false, failedCheck: "template_not_approved" };
  }
  return { passed: true };
}
