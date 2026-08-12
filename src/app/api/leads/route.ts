import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Lists recent leads for the /leads UI, optionally scoped to a campaign
 * (via their Conversation link, unchanged join). Read-only — does not
 * write anything.
 */
export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get("campaignId");

  const leads = await prisma.lead.findMany({
    where: campaignId ? { conversations: { some: { campaignId } } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      phoneE164: true,
      name: true,
      optedIn: true,
      createdAt: true,
      conversations: {
        where: campaignId ? { campaignId } : undefined,
        select: { id: true, campaignId: true },
        take: 1,
      },
    },
  });

  return NextResponse.json({ leads });
}
