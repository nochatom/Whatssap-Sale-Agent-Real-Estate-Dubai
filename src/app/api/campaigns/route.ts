import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

interface CreateCampaignBody {
  name: string;
  templateName: string;
  templateStatus?: "PENDING" | "APPROVED" | "REJECTED";
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  dailyBudgetPerNumber: number;
  senderPhoneNumberId: string;
  followUpDelayMinutes?: number | null;
}

/**
 * Creates a Campaign using exactly the fields the existing Prisma model
 * defines — no new columns, no new model. Campaign ID/read access is
 * unchanged (GET is still the direct Prisma query in campaigns/page.tsx;
 * this only adds the write side that page's own comment noted didn't
 * exist yet).
 */
export async function POST(request: NextRequest) {
  let body: CreateCampaignBody;
  try {
    body = (await request.json()) as CreateCampaignBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.templateName?.trim()) {
    return NextResponse.json({ error: "templateName is required" }, { status: 400 });
  }
  if (!body.senderPhoneNumberId?.trim()) {
    return NextResponse.json({ error: "senderPhoneNumberId is required" }, { status: 400 });
  }
  if (!Number.isFinite(body.dailyBudgetPerNumber) || body.dailyBudgetPerNumber < 0) {
    return NextResponse.json({ error: "dailyBudgetPerNumber must be a non-negative number" }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: body.name.trim(),
      templateName: body.templateName.trim(),
      templateStatus: body.templateStatus ?? "PENDING",
      status: body.status ?? "DRAFT",
      dailyBudgetPerNumber: body.dailyBudgetPerNumber,
      senderPhoneNumberId: body.senderPhoneNumberId.trim(),
      followUpDelayMinutes:
        body.followUpDelayMinutes !== undefined && body.followUpDelayMinutes !== null
          ? body.followUpDelayMinutes
          : null,
    },
  });

  return NextResponse.json({ campaign });
}

/**
 * Deletes a single Campaign. Conversation.campaignId and Asset.campaignId
 * are both optional fields, so Prisma's default (unset) onDelete action for
 * them is SetNull, not Restrict — deleting a campaign would silently null
 * out real conversations' campaignId instead of failing at the database, no
 * P2003 to catch. So this checks for linked rows explicitly first, the same
 * "never silently detach/destroy real history" intent as the Lead DELETE
 * route's P2003 catch, just enforced in application code since the DB
 * constraint doesn't do it for this relation shape.
 */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { _count: { select: { conversations: true, assets: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign._count.conversations > 0 || campaign._count.assets > 0) {
    return NextResponse.json(
      { error: "Can't delete — this campaign has leads or conversations linked to it." },
      { status: 409 },
    );
  }

  try {
    await prisma.campaign.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ deleted: true });
}
