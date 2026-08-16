import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildManualReplyIdempotencyKey } from "@/whatsapp/idempotency";
import { sendOutbound } from "@trigger/send-outbound";

interface ReplyBody {
  body: string;
}

// Same list as /api/leads/send — known "expected in test/dev mode" throw
// messages, classified separately from genuine errors so the UI shows them
// as a correct safety block (200) rather than a server failure (500).
const EXPECTED_TEST_MODE_BLOCKS = [
  "WHATSAPP_ACCESS_TOKEN is not set",
  "WHATSAPP_TEMPLATE_LANGUAGE is not set",
  "Outbound sending is disabled",
];

/**
 * Manual free-text reply from the Inbox. Calls the existing, unchanged
 * sendOutbound() — the same centralized, compliance-gated send path every
 * other send in this app already goes through (campaign opener, AI reply,
 * follow-up). Nothing here bypasses the compliance gate or invents a new
 * send mechanism; this is just a new caller of the existing one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: ReplyBody;
  try {
    body = (await request.json()) as ReplyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.body?.trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { campaign: { select: { id: true, senderPhoneNumberId: true } } },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const senderPhoneNumberId = conversation.campaign?.senderPhoneNumberId ?? conversation.senderPhoneNumberId;
  if (!senderPhoneNumberId) {
    return NextResponse.json(
      { error: "No sender phone number known for this conversation — it has no campaign and no inbound message has set one yet" },
      { status: 409 },
    );
  }

  try {
    const result = await sendOutbound({
      conversationId: conversation.id,
      campaignId: conversation.campaign?.id,
      leadId: conversation.leadId,
      senderPhoneNumberId,
      idempotencyKey: buildManualReplyIdempotencyKey(conversation.id),
      body: body.body.trim(),
      isTemplate: false,
    });
    return NextResponse.json({ outcome: "returned", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isExpectedBlock = EXPECTED_TEST_MODE_BLOCKS.some((known) => message.includes(known));
    return NextResponse.json(
      { outcome: isExpectedBlock ? "blocked_before_send" : "error", message },
      { status: isExpectedBlock ? 200 : 500 },
    );
  }
}
