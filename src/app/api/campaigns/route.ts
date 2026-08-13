import { NextRequest, NextResponse } from "next/server";

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
