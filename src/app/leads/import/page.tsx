import { prisma } from "@/lib/prisma";
import ImportClient from "./ImportClient";

// Fetches the campaign list for the optional "link to campaign" dropdown —
// must render per-request, not be statically prerendered at build time,
// when no DATABASE_URL is available.
export const dynamic = "force-dynamic";

/**
 * Server component so the campaign dropdown can be populated from the real
 * database without a new API route — same pattern as every other page in
 * this app (server component fetches, client component handles
 * interactivity).
 */
export default async function ImportPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  return <ImportClient campaigns={campaigns} />;
}
