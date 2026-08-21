import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Permanently deletes every row backing the Dashboard's cumulative
 * statistics (Total Leads, Messages Sent, Conversations, AI Auto-Decisions,
 * Follow-ups Due) — FollowUp, AiDecision, Message, Conversation, Lead, in
 * that order to respect the real FK constraints (all RESTRICT between these
 * five tables between each other — verified against the actual migration
 * SQL, not assumed).
 *
 * Deliberately untouched:
 * - Campaign — configuration, not a Dashboard statistic. Conversation.campaignId
 *   is ON DELETE SET NULL, so deleting Conversations never requires touching
 *   Campaign rows.
 * - Asset — ON DELETE SET NULL on both campaignId and leadId, so an Asset
 *   survives this with its leadId cleared rather than being deleted.
 * - SuppressionList — compliance opt-out data, never a Dashboard statistic.
 *   Deleting it would be a real compliance risk (previously suppressed
 *   numbers becoming sendable again), so it's out of scope on purpose.
 *
 * No soft-delete, no backup — a genuine, irreversible deletion, by explicit
 * product decision. The UI is responsible for confirming with the user
 * before ever calling this.
 */
export async function POST() {
  const [followUps, aiDecisions, messages, conversations, leads] = await prisma.$transaction([
    prisma.followUp.deleteMany({}),
    prisma.aiDecision.deleteMany({}),
    prisma.message.deleteMany({}),
    prisma.conversation.deleteMany({}),
    prisma.lead.deleteMany({}),
  ]);

  return NextResponse.json({
    deleted: {
      followUps: followUps.count,
      aiDecisions: aiDecisions.count,
      messages: messages.count,
      conversations: conversations.count,
      leads: leads.count,
    },
  });
}
