const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * The WhatsApp Business Account this app's only sender number belongs to
 * (verified directly against the Graph API — "Cherno Samba Limited",
 * +213 673 75 32 29). There is exactly one WABA in play; env override exists
 * only in case that ever changes, not because a second one currently does.
 */
const DEFAULT_WABA_ID = "2140666990221175";

export interface MetaTemplateInfo {
  name: string;
  status: string;
  language: string;
}

/**
 * Meta's template list UI displays entries as "name · Language" — a real
 * incident (2026-08-31) came from that exact string getting pasted straight
 * into the plain-text templateName field instead of just the template's
 * actual name, which made it fail to match anything on Meta's side and left
 * templateStatus stuck at its PENDING default forever, with no code path
 * that would ever correct it. Strips that suffix so a pasted display label
 * still resolves correctly.
 */
export function stripTemplateDisplaySuffix(rawName: string): string {
  return rawName.split(" · ")[0]?.trim() ?? rawName.trim();
}

/**
 * Looks up one template's live status directly from Meta — the actual
 * source of truth. Campaign.templateStatus is a plain DB column with no
 * automatic sync of its own; this is what powers the manual "Sync from
 * Meta" action rather than trusting whatever was typed in at campaign
 * creation.
 */
export async function fetchMetaTemplateStatus(
  templateName: string,
  accessToken: string,
): Promise<MetaTemplateInfo | null> {
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? DEFAULT_WABA_ID;
  const cleanedName = stripTemplateDisplaySuffix(templateName);

  const response = await fetch(
    `${GRAPH_API_BASE}/${wabaId}/message_templates?fields=name,status,language&limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Meta template lookup failed (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { data?: MetaTemplateInfo[] };
  const templates = data.data ?? [];
  return templates.find((t) => t.name === cleanedName) ?? null;
}
