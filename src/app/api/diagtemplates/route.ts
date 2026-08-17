import { NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route — not part of the product surface. Reuses the
 * server's own already-configured WHATSAPP_ACCESS_TOKEN to enumerate the
 * WABAs owned by a given Business ID (?businessId=), and each WABA's phone
 * numbers + whether it has a "property_video_intro_v1" template. Delete this
 * file once the answer is known.
 */
export async function GET(request: NextRequest) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const businessId = request.nextUrl.searchParams.get("businessId");

  if (!token || !businessId) {
    return NextResponse.json({ error: "Missing WHATSAPP_ACCESS_TOKEN or businessId" }, { status: 500 });
  }

  const wabaRes = await fetch(`https://graph.facebook.com/v21.0/${businessId}/owned_whatsapp_business_accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wabaJson = await wabaRes.json();

  const wabaResults: unknown[] = [];
  for (const waba of wabaJson?.data ?? []) {
    const [phonesRes, templatesRes, subscribedAppsRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${waba.id}/phone_numbers`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://graph.facebook.com/v21.0/${waba.id}/message_templates?name=property_video_intro_v1`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://graph.facebook.com/v21.0/${waba.id}/subscribed_apps`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    const [phonesJson, templatesJson, subscribedAppsJson] = await Promise.all([
      phonesRes.json(),
      templatesRes.json(),
      subscribedAppsRes.json(),
    ]);
    wabaResults.push({
      wabaId: waba.id,
      wabaName: waba.name,
      phoneNumbers: phonesJson,
      propertyVideoTemplate: templatesJson,
      subscribedApps: subscribedAppsJson,
    });
  }

  return NextResponse.json({ businessId, wabaJson, wabaResults });
}
