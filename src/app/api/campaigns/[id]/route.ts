import { NextRequest, NextResponse } from "next/server";
import type { CampaignStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { prismaErrorResponse } from "@/lib/prisma-errors";
import { stripTemplateDisplaySuffix } from "@/whatsapp/templates";

const VALID_CAMPAIGN_STATUSES: CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"];

interface PatchBody {
  /**
   * Master toggle for the fixed 2-stage (48h/48h) campaign follow-up
   * sequence — OFF by default per campaign. Distinct from
   * Campaign.followUpDelayMinutes, which drives a different, unrelated
   * AI-decision-triggered follow-up mechanism.
   */
  campaignFollowUpEnabled?: boolean;
  /**
   * Delay, in minutes, before the OTHER follow-up mechanism fires — the
   * organic one, triggered when the Skill's decision is explicitly
   * "do_not_follow_up_yet" mid-conversation (see maybeScheduleFollowUp in
   * trigger/schedule-followup.ts). Optional: omit to leave the campaign's
   * current value untouched. Pass null to clear it (that mechanism then
   * schedules nothing for this campaign, same as never having set it).
   * Never touches the fixed 48h/48h sequence above, which has its own
   * hardcoded interval and doesn't read this field at all.
   */
  followUpDelayMinutes?: number | null;
  /**
   * Campaign.status — DRAFT | ACTIVE | PAUSED | ARCHIVED. Optional: omit to
   * leave unchanged. There was previously no way at all to change this
   * after creation (the create form's dropdown was the only place it could
   * ever be set), which silently blocked every send from a campaign left
   * in DRAFT — checkCampaignActive in src/compliance/checks.ts requires
   * exactly "ACTIVE". This lets the "Activate"/"Pause" button correct that.
   */
  status?: CampaignStatus;
  /**
   * Switches which Meta-approved template this campaign sends. Optional:
   * omit to leave unchanged. Does NOT touch templateStatus by itself —
   * changing the name doesn't tell you the new template's real approval
   * state, so pair this with a follow-up call to
   * POST /api/campaigns/[id]/sync-template to correct templateStatus from
   * Meta rather than guessing it here. Runs the same display-suffix strip
   * as the create form (Meta's own UI shows templates as "name ·
   * Language") so pasting that label doesn't corrupt the value.
   */
  templateName?: string;
}

/**
 * Updates a Campaign's follow-up configuration. campaignFollowUpEnabled
 * stays required on every call (unchanged from the original narrow toggle
 * endpoint); followUpDelayMinutes is additive and optional so existing
 * callers that only ever sent the boolean keep working unmodified.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.campaignFollowUpEnabled !== "boolean") {
    return NextResponse.json({ error: "campaignFollowUpEnabled (boolean) is required" }, { status: 400 });
  }

  let followUpDelayMinutes: number | null | undefined;
  if ("followUpDelayMinutes" in body) {
    const value = body.followUpDelayMinutes;
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
      return NextResponse.json(
        { error: "followUpDelayMinutes must be a positive integer or null" },
        { status: 400 },
      );
    }
    followUpDelayMinutes = value;
  }

  if ("status" in body && !VALID_CAMPAIGN_STATUSES.includes(body.status as CampaignStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_CAMPAIGN_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  let templateName: string | undefined;
  if ("templateName" in body) {
    const cleaned = stripTemplateDisplaySuffix(String(body.templateName ?? ""));
    if (!cleaned) {
      return NextResponse.json({ error: "templateName must be a non-empty string" }, { status: 400 });
    }
    templateName = cleaned;
  }

  try {
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        campaignFollowUpEnabled: body.campaignFollowUpEnabled,
        ...(followUpDelayMinutes !== undefined ? { followUpDelayMinutes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(templateName !== undefined ? { templateName } : {}),
      },
    });
    return NextResponse.json({ campaign });
  } catch (err) {
    const response = prismaErrorResponse(err, "P2025", "Campaign not found");
    if (response) return response;
    throw err;
  }
}
