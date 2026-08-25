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
}

/**
 * Toggles a Campaign's follow-up sequence on/off. The only field this route
 * updates today — kept narrow (one field, one purpose) rather than a
 * general campaign-edit endpoint, since nothing else currently needs one.
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

  try {
    const campaign = await prisma.campaign.update({
      where: { id },
      data: { campaignFollowUpEnabled: body.campaignFollowUpEnabled },
    });
    return NextResponse.json({ campaign });
  } catch (err) {
    const response = prismaErrorResponse(err, "P2025", "Campaign not found");
    if (response) return response;
    throw err;
  }
}
