import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { prismaErrorResponse } from "@/lib/prisma-errors";

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

  try {
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        campaignFollowUpEnabled: body.campaignFollowUpEnabled,
        ...(followUpDelayMinutes !== undefined ? { followUpDelayMinutes } : {}),
      },
    });
    return NextResponse.json({ campaign });
  } catch (err) {
    const response = prismaErrorResponse(err, "P2025", "Campaign not found");
    if (response) return response;
    throw err;
  }
}
