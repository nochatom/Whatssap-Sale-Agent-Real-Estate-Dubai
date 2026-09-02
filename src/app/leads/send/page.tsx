import { prisma } from "@/lib/prisma";
import SendLeadsLoader from "./SendLeadsLoader";

// Queries the DB on every load — must render per-request, not be
// statically prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Server component: resolves the campaign list via Prisma directly, same
 * pattern as every other page here. The selected leads are NOT resolved
 * here — they used to come from a `?leadIds=...` query param, but that
 * broke for large selections (cuids are 25 chars each, so a selection in
 * the hundreds/thousands produced a URL well past typical header-size
 * limits). SendLeadsLoader (client) now reads the selection out of
 * sessionStorage and fetches the actual lead rows via a POST body instead,
 * which has no comparable length ceiling.
 *
 * No Test Mode banner on this page (removed on request) — SENDING_ENABLED
 * itself is untouched and still unset/false, so /api/leads/send still
 * hard-blocks any real WhatsApp send exactly as before; only the UI notice
 * about it is gone.
 */
export default async function SendCampaignPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, templateName: true, templateStatus: true },
  });

  return <SendLeadsLoader campaigns={campaigns} />;
}
