import { NextRequest, NextResponse } from "next/server";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Proxies a WhatsApp media attachment. Meta's media URLs are short-lived
 * (expire within minutes) and require the access token to fetch even once
 * resolved, so the real media ID (stored on Message.mediaId) is resolved to
 * a fresh URL on every request rather than ever being cached/stored as a
 * direct link. Keeps WHATSAPP_ACCESS_TOKEN server-side only.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "WHATSAPP_ACCESS_TOKEN is not set" }, { status: 500 });
  }

  const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) {
    const errorBody = await metaRes.text();
    return NextResponse.json({ error: `Failed to resolve media (${metaRes.status}): ${errorBody}` }, { status: 502 });
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) {
    return NextResponse.json({ error: "Media metadata missing url" }, { status: 502 });
  }

  const mediaRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!mediaRes.ok || !mediaRes.body) {
    return NextResponse.json({ error: `Failed to fetch media bytes (${mediaRes.status})` }, { status: 502 });
  }

  return new NextResponse(mediaRes.body, {
    headers: {
      "Content-Type": meta.mime_type ?? mediaRes.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
