import { NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route — not part of the product surface. Reuses the
 * server's own already-configured WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID
 * to answer: which WABA does this phone number belong to, and does that WABA
 * actually have a "property_video_intro_v1" template (in any language)?
 * Delete this file once the answer is known.
 */
export async function GET() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return NextResponse.json({ error: "Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID" }, { status: 500 });
  }

  const phoneRes = await fetch(
    `https://graph.facebook.com/v21.0/${phoneId}?fields=whatsapp_business_account,verified_name,display_phone_number`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const phoneJson = await phoneRes.json();

  const wabaId = phoneJson?.whatsapp_business_account?.id;
  let templates: unknown = null;
  if (wabaId) {
    const tRes = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=property_video_intro_v1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    templates = await tRes.json();
  }

  return NextResponse.json({ phoneId, phoneJson, wabaId, templates });
}
