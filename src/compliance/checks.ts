import type { Campaign, Conversation, Lead } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";

import { prisma } from "@/lib/prisma";

export type ComplianceFailure =
  | "suppression"
  | "opt_out"
  | "campaign_inactive"
  | "idempotency_conflict"
  | "service_window_closed"
  | "template_not_approved"
  | "toll_free_number";

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

/**
 * Toll-free numbers (800/833/844/855/866/877/888 in the North American
 * Numbering Plan) are call-center/IVR infrastructure, never a personal
 * device — they cannot have a WhatsApp account. Confirmed via a real
 * production incident (2026-09-01): a campaign of 40 sends included 14
 * toll-free numbers, all accepted by Meta's API (real message ids
 * returned) but none ever delivered, since there was no WhatsApp client on
 * the other end. libphonenumber-js's line-type classification is free,
 * local, and deterministic for this — no external lookup needed.
 *
 * Scoped to template sends only, the same way checkServiceWindow is scoped
 * in reverse: a toll-free number could never have replied to reach an
 * organic free-text conversation in the first place, so this only matters
 * for cold campaign-opener sends.
 */
export function checkNotTollFree(phoneE164: string, isTemplate: boolean): boolean {
  if (!isTemplate) return true;
  const parsed = parsePhoneNumberFromString(phoneE164);
  return parsed?.getType() !== "TOLL_FREE";
}

/**
 * No campaign means there is nothing to be "inactive" — an organically
 * initiated conversation was never gated by a campaign's status in the first
 * place. Not a weakening: this check's precondition (a campaign exists)
 * simply doesn't hold, the same pattern checkTemplateApproval and
 * checkServiceWindow already use for their own not-applicable cases.
 */
export function checkCampaignActive(campaign: Pick<Campaign, "status"> | null): boolean {
  if (!campaign) return true;
  return campaign.status === "ACTIVE";
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
 * A template send is only legal against a Meta-approved template, and a
 * template always belongs to a campaign — there is no such thing as an
 * organic template send. isTemplate: true with no campaign fails closed
 * (false), it does not skip. Free-text sends aren't gated by this at all —
 * they're gated by checkServiceWindow instead.
 */
export function checkTemplateApproval(
  campaign: Pick<Campaign, "templateStatus"> | null,
  isTemplate: boolean,
): boolean {
  if (!isTemplate) return true;
  if (!campaign) return false;
  return campaign.templateStatus === "APPROVED";
}

export interface RunComplianceGateParams {
  phoneE164: string;
  lead: Pick<Lead, "optedIn">;
  /**
   * Null for an organically initiated conversation (no Campaign). Suppression,
   * opt-out, idempotency, and the 24h service window are unaffected — they
   * never depended on a campaign. Only checkCampaignActive (nothing to check)
   * and checkTemplateApproval (fails closed) change behavior, per their own
   * docs above.
   */
  campaign: Pick<Campaign, "id" | "status" | "templateStatus"> | null;
  conversation: Pick<Conversation, "lastInboundAt">;
  idempotencyKey: string;
  isTemplate: boolean;
}

/**
 * Aggregates all compliance gates. The single centralized call site is
 * send-outbound.ts, immediately before every send.
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
  if (!checkNotTollFree(params.phoneE164, params.isTemplate)) {
    return { passed: false, failedCheck: "toll_free_number" };
  }
  if (!checkCampaignActive(params.campaign)) {
    return { passed: false, failedCheck: "campaign_inactive" };
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
