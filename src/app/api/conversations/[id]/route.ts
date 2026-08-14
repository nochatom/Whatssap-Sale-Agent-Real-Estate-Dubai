import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Deletes a single Conversation. No cascade — same precedent as the existing
 * Lead/Campaign DELETE routes: a conversation with real message/AI-decision/
 * follow-up history fails at the database (P2003) rather than silently
 * destroying that history.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await prisma.conversation.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Can't delete — this conversation has message history linked to it." },
          { status: 409 },
        );
      }
    }
    throw err;
  }

  return NextResponse.json({ deleted: true });
}
