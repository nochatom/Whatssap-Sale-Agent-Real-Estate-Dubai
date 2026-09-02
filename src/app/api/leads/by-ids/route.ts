import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Fetches leads by id, given as a JSON body array rather than a URL query
 * string. Exists specifically so the Select Leads -> Send Campaign handoff
 * (SendLeadsLoader.tsx) isn't bounded by URL/header length limits the way
 * `?leadIds=a,b,c...` was — a large selection (up to the 2000 the Select
 * Leads page can show) can produce an id list too long for a query string,
 * but a POST body has no such ceiling.
 */
export async function POST(request: NextRequest) {
  let body: { leadIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.leadIds) || !body.leadIds.every((v) => typeof v === "string")) {
    return NextResponse.json({ error: "leadIds must be an array of strings" }, { status: 400 });
  }
  const leadIds = body.leadIds;

  if (leadIds.length === 0) {
    return NextResponse.json({ leads: [] });
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, phoneE164: true, name: true },
  });

  return NextResponse.json({ leads });
}
