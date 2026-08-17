import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Deletes a Conversation and, explicitly, all of its history — FollowUp,
 * AiDecision, Message — before the Conversation row itself, in FK-safe
 * child-to-parent order, in one atomic transaction. Per explicit product
 * decision this is no longer blocked by real message history (the prior
 * P2003-based refusal is gone, same change already made for Lead delete);
 * the UI is responsible for confirming with the user first, since this is
 * genuinely destructive and irreversible.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await prisma.$transaction([
      prisma.followUp.deleteMany({ where: { conversationId: id } }),
      prisma.aiDecision.deleteMany({ where: { conversationId: id } }),
      prisma.message.deleteMany({ where: { conversationId: id } }),
      prisma.conversation.delete({ where: { id } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ deleted: true });
}

interface PatchBody {
  /** Set to false to explicitly unmark as read. */
  read?: boolean;
  /** Set to false to restore a previously archived conversation. */
  archived?: boolean;
}

/**
 * Marks a conversation read (readAt = now) or unread (readAt = null), and/or
 * archived (archivedAt = now) or restored (archivedAt = null). Both are real
 * fields (Conversation.readAt, Conversation.archivedAt), not repurposings of
 * anything existing. Either or both may be set in one call; at least one is
 * required.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.read !== "boolean" && typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "read (boolean) and/or archived (boolean) is required" }, { status: 400 });
  }

  const data: { readAt?: Date | null; archivedAt?: Date | null } = {};
  if (typeof body.read === "boolean") data.readAt = body.read ? new Date() : null;
  if (typeof body.archived === "boolean") data.archivedAt = body.archived ? new Date() : null;

  try {
    const conversation = await prisma.conversation.update({ where: { id }, data });
    return NextResponse.json({ id: conversation.id, readAt: conversation.readAt, archivedAt: conversation.archivedAt });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    throw err;
  }
}
