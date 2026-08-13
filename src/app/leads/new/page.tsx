import { prisma } from "@/lib/prisma";
import NewLeadClient from "./NewLeadClient";

// Fetches the campaign list for the optional "link to campaign" dropdown —
// must render per-request, not be statically prerendered at build time.
export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  return <NewLeadClient campaigns={campaigns} />;
}
