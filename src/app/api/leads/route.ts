import { NextRequest, NextResponse } from "next/server";
import type { CountryCode } from "libphonenumber-js";

import { prisma } from "@/lib/prisma";
import { prismaErrorResponse } from "@/lib/prisma-errors";
import { normalizePhoneToE164 } from "@/csv/phone";

/**
 * Lists recent leads for the /leads UI, optionally scoped to a campaign
 * (via their Conversation link, unchanged join). Read-only — does not
 * write anything.
 */
export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get("campaignId");

  const leads = await prisma.lead.findMany({
    where: campaignId ? { conversations: { some: { campaignId } } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      phoneE164: true,
      name: true,
      optedIn: true,
      createdAt: true,
      conversations: {
        where: campaignId ? { campaignId } : undefined,
        select: { id: true, campaignId: true },
        take: 1,
      },
    },
  });

  return NextResponse.json({ leads });
}

interface CreateLeadBody {
  phone: string;
  name?: string;
  market?: string;
  language?: string;
  optedIn?: boolean;
  defaultCountry?: string;
  campaignId?: string;
}

/**
 * Manual single-lead creation — same phone normalization
 * (normalizePhoneToE164) and the exact same Lead<->Campaign linking
 * pattern (a Conversation row) that CSV import already uses, not a
 * second implementation of either. Uniqueness is enforced by the
 * existing Lead.phoneE164 @unique constraint — a duplicate phone number
 * fails at the database, not via new dedupe logic.
 */
export async function POST(request: NextRequest) {
  let body: CreateLeadBody;
  try {
    body = (await request.json()) as CreateLeadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.phone?.trim()) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const normalized = normalizePhoneToE164(body.phone, body.defaultCountry as CountryCode | undefined);
  if (!normalized.ok || !normalized.e164) {
    return NextResponse.json({ error: normalized.reason ?? "Invalid phone number" }, { status: 400 });
  }

  let lead;
  try {
    lead = await prisma.lead.create({
      data: {
        phoneE164: normalized.e164,
        name: body.name?.trim() || undefined,
        market: body.market?.trim() || undefined,
        language: body.language?.trim() || undefined,
        optedIn: body.optedIn ?? false,
      },
    });
  } catch (err) {
    const response = prismaErrorResponse(err, "P2002", "A lead with this phone number already exists", 409);
    if (response) return response;
    throw err;
  }

  let conversationCreated = false;
  if (body.campaignId) {
    await prisma.conversation.create({ data: { leadId: lead.id, campaignId: body.campaignId } });
    conversationCreated = true;
  }

  return NextResponse.json({ lead, conversationCreated });
}

/**
 * Deletes one or more Leads and, explicitly, all of their conversation
 * history — FollowUp, AiDecision, Message, Asset, Conversation — before the
 * Lead rows themselves, in FK-safe child-to-parent order. Per explicit
 * product decision, this is no longer blocked by real history (the prior
 * P2003-based refusal is gone); the UI is responsible for confirming with
 * the user before calling this, since it's now genuinely destructive and
 * irreversible. Wrapped in a single transaction so a failure partway through
 * never leaves orphaned rows, and so a multi-lead delete is one atomic
 * all-or-nothing operation instead of N separate requests racing against
 * whatever else the UI does while they're in flight.
 *
 * Two call shapes, both supported: `?id=<single>` (existing callers,
 * unchanged — still a real `delete()` that 404s via P2025 if already gone)
 * or a JSON body `{ ids: string[] }` for a genuine bulk delete (uses
 * `deleteMany`, which silently no-ops on any id that's already gone rather
 * than erroring — acceptable for the bulk case, where "some of these were
 * already deleted" isn't worth a partial-failure UX).
 */
export async function DELETE(request: NextRequest) {
  const singleId = request.nextUrl.searchParams.get("id");

  if (singleId) {
    try {
      await prisma.$transaction([
        prisma.followUp.deleteMany({ where: { leadId: singleId } }),
        prisma.aiDecision.deleteMany({ where: { conversation: { leadId: singleId } } }),
        prisma.message.deleteMany({ where: { conversation: { leadId: singleId } } }),
        prisma.asset.deleteMany({ where: { leadId: singleId } }),
        prisma.conversation.deleteMany({ where: { leadId: singleId } }),
        prisma.lead.delete({ where: { id: singleId } }),
      ]);
    } catch (err) {
      const response = prismaErrorResponse(err, "P2025", "Lead not found");
      if (response) return response;
      throw err;
    }
    return NextResponse.json({ deleted: true, count: 1 });
  }

  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "id (query param) or ids (JSON body array) is required" }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((v) => typeof v === "string")) {
    return NextResponse.json({ error: "ids must be a non-empty array of strings" }, { status: 400 });
  }
  const ids = body.ids;

  await prisma.$transaction([
    prisma.followUp.deleteMany({ where: { leadId: { in: ids } } }),
    prisma.aiDecision.deleteMany({ where: { conversation: { leadId: { in: ids } } } }),
    prisma.message.deleteMany({ where: { conversation: { leadId: { in: ids } } } }),
    prisma.asset.deleteMany({ where: { leadId: { in: ids } } }),
    prisma.conversation.deleteMany({ where: { leadId: { in: ids } } }),
    prisma.lead.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return NextResponse.json({ deleted: true, count: ids.length });
}
