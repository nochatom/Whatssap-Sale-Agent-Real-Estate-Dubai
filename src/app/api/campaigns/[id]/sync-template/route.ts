import { NextRequest, NextResponse } from "next/server";
import type { TemplateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { prismaErrorResponse } from "@/lib/prisma-errors";
import { fetchMetaTemplateStatus, stripTemplateDisplaySuffix } from "@/whatsapp/templates";

/**
 * Maps Meta's real-world status strings onto this app's narrower
 * TemplateStatus enum (PENDING | APPROVED | REJECTED). Meta's API can also
 * return values like DISABLED, IN_APPEAL, or PAUSED — none of those mean the
 * template is safe to send with, so they fold into PENDING (the enum's own
 * default) rather than inventing new enum values for edge cases this app
 * has no other handling for yet.
 */
function toTemplateStatus(metaStatus: string): TemplateStatus {
  if (metaStatus === "APPROVED") return "APPROVED";
  if (metaStatus === "REJECTED") return "REJECTED";
  return "PENDING";
}

/**
 * Re-fetches a campaign's template status directly from Meta and corrects
 * both templateStatus and templateName in the DB — the fix for
 * Campaign.templateStatus never being anything but whatever was manually
 * typed in at creation (see NewCampaignClient.tsx), with no code path that
 * ever reconciled it against reality afterward.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "WHATSAPP_ACCESS_TOKEN is not set" }, { status: 500 });
  }

  let campaign;
  try {
    campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  } catch (err) {
    const response = prismaErrorResponse(err, "P2025", "Campaign not found");
    if (response) return response;
    throw err;
  }

  let match;
  try {
    match = await fetchMetaTemplateStatus(campaign.templateName, accessToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Meta template lookup failed" },
      { status: 502 },
    );
  }

  if (!match) {
    return NextResponse.json(
      {
        error: `No template named "${stripTemplateDisplaySuffix(campaign.templateName)}" was found on Meta's WhatsApp Business Account`,
      },
      { status: 404 },
    );
  }

  const updated = await prisma.campaign.update({
    where: { id },
    data: { templateName: match.name, templateStatus: toTemplateStatus(match.status) },
  });

  return NextResponse.json({ campaign: updated, metaStatus: match.status, metaLanguage: match.language });
}
