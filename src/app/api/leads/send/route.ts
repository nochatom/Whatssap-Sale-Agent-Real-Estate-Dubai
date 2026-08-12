import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildCampaignOpenerIdempotencyKey } from "@/whatsapp/idempotency";
import { sendOutbound } from "@trigger/send-outbound";

interface SendRequestBody {
  leadId: string;
  campaignId: string;
}

/**
 * Calls the existing, unchanged sendOutbound() directly — the same
 * centralized, compliance-gated send path start-campaign uses, just
 * synchronous instead of queued through Trigger.dev, so this route can
 * return the real outcome immediately for the UI to show. Nothing here
 * bypasses the Compliance Gate, and nothing here can make sendOutbound
 * actually deliver a message — sendMessage/sendTemplateMessage still
 * hard-throw unless SENDING_ENABLED === "true", which stays unset.
 *
 * Known "expected in test mode" throw messages are classified separately
 * from genuine errors so the UI can show them as a correct safety block
 * rather than a server failure.
 */
const EXPECTED_TEST_MODE_BLOCKS = [
  "WHATSAPP_ACCESS_TOKEN is not set",
  "WHATSAPP_TEMPLATE_LANGUAGE is not set",
  "Outbound sending is disabled",
];

export async function POST(request: NextRequest) {
  let body: SendRequestBody;
  try {
    body = (await request.json()) as SendRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.leadId || !body.campaignId) {
    return NextResponse.json({ error: "leadId and campaignId are required" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { leadId: body.leadId, campaignId: body.campaignId },
  });
  if (!conversation) {
    return NextResponse.json(
      { error: "No conversation links this lead to this campaign — import the lead into this campaign first" },
      { status: 404 },
    );
  }

  const campaign = await prisma.campaign.findUnique({ where: { id: body.campaignId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  try {
    const result = await sendOutbound({
      conversationId: conversation.id,
      campaignId: campaign.id,
      leadId: body.leadId,
      senderPhoneNumberId: campaign.senderPhoneNumberId,
      idempotencyKey: buildCampaignOpenerIdempotencyKey(campaign.id, body.leadId),
      isTemplate: true,
    });
    // result.sent is only ever true if SENDING_ENABLED is "true" AND every
    // compliance check passed — never true in this test environment, but
    // reported factually either way, never phrased as a delivery guarantee.
    return NextResponse.json({ testMode: true, outcome: "returned", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isExpectedBlock = EXPECTED_TEST_MODE_BLOCKS.some((known) => message.includes(known));
    return NextResponse.json(
      { testMode: true, outcome: isExpectedBlock ? "blocked_before_send" : "error", message },
      { status: isExpectedBlock ? 200 : 500 },
    );
  }
}
