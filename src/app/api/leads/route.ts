import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { CountryCode } from "libphonenumber-js";

import { prisma } from "@/lib/prisma";
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A lead with this phone number already exists" }, { status: 409 });
    }
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
 * Deletes a Lead and, explicitly, all of its conversation history —
 * FollowUp, AiDecision, Message, Asset, Conversation — before the Lead row
 * itself, in FK-safe child-to-parent order. Per explicit product decision,
 * this is no longer blocked by real history (the prior P2003-based refusal
 * is gone); the UI is responsible for confirming with the user before
 * calling this, since it's now genuinely destructive and irreversible.
 * Wrapped in a transaction so a failure partway through never leaves
 * orphaned rows — either the whole lead + its history is gone, or nothing
 * is.
 */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await prisma.$transaction([
      prisma.followUp.deleteMany({ where: { leadId: id } }),
      prisma.aiDecision.deleteMany({ where: { conversation: { leadId: id } } }),
      prisma.message.deleteMany({ where: { conversation: { leadId: id } } }),
      prisma.asset.deleteMany({ where: { leadId: id } }),
      prisma.conversation.deleteMany({ where: { leadId: id } }),
      prisma.lead.delete({ where: { id } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ deleted: true });
}
