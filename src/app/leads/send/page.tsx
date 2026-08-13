import { prisma } from "@/lib/prisma";
import SendCampaignClient from "./SendCampaignClient";

// Reads SENDING_ENABLED and the DB on every load — must render per-request,
// not be statically prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Server component: resolves the campaign list and the selected leads (from
 * the ?leadIds= query param set by the Select Leads page) via Prisma
 * directly — same pattern as every other page here, no new API route
 * needed for read-only data this page's own render already has access to.
 */
export default async function SendCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ leadIds?: string }>;
}) {
  const sendingEnabled = process.env.SENDING_ENABLED === "true";
  const { leadIds: leadIdsParam } = await searchParams;
  const leadIds = leadIdsParam ? leadIdsParam.split(",").filter(Boolean) : [];

  const [campaigns, leads] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, templateName: true, templateStatus: true },
    }),
    leadIds.length > 0
      ? prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, phoneE164: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return <SendCampaignClient sendingEnabled={sendingEnabled} campaigns={campaigns} leads={leads} />;
}
