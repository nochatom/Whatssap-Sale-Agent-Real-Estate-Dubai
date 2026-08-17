import { NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route — not part of the product surface. Reuses the
 * server's own already-configured WHATSAPP_ACCESS_TOKEN to answer: which WABA
 * does the given phone number belong to, and does that WABA actually have a
 * "property_video_intro_v1" template (in any language)? Phone number ID is
 * passed as ?phoneId= since the campaign's senderPhoneNumberId can differ
 * from the WHATSAPP_PHONE_NUMBER_ID env var. Delete this file once answered.
 */
export async function GET(request: NextRequest) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = request.nextUrl.searchParams.get("phoneId") ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return NextResponse.json({ error: "Missing WHATSAPP_ACCESS_TOKEN or phoneId" }, { status: 500 });
  }

  const phoneRes = await fetch(
    `https://graph.facebook.com/v21.0/${phoneId}?fields=verified_name,display_phone_number,quality_rating`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const phoneJson = await phoneRes.json();

  const businessesRes = await fetch(`https://graph.facebook.com/v21.0/me/businesses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const businessesJson = await businessesRes.json();

  const wabaResults: unknown[] = [];
  for (const biz of businessesJson?.data ?? []) {
    const wabaRes = await fetch(
      `https://graph.facebook.com/v21.0/${biz.id}/owned_whatsapp_business_accounts`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const wabaJson = await wabaRes.json();
    for (const waba of wabaJson?.data ?? []) {
      const tRes = await fetch(
        `https://graph.facebook.com/v21.0/${waba.id}/message_templates?name=property_video_intro_v1`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const tJson = await tRes.json();
      const phonesRes = await fetch(`https://graph.facebook.com/v21.0/${waba.id}/phone_numbers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const phonesJson = await phonesRes.json();
      wabaResults.push({ businessId: biz.id, businessName: biz.name, wabaId: waba.id, templates: tJson, phoneNumbers: phonesJson });
    }
  }

  return NextResponse.json({ phoneId, phoneJson, businessesJson, wabaResults });
}
