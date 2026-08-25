import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Milestone } from "./types";

/**
 * AiDecision.parsedDecision is a Prisma Json column (untyped at the DB
 * layer) — this reads clientAnalysis.milestone back out defensively, never
 * throwing on a null, non-object, or older-shape value (e.g. a decision
 * persisted before the milestone field existed).
 */
export function extractMilestone(parsedDecision: Prisma.JsonValue | null | undefined): string | undefined {
  if (typeof parsedDecision !== "object" || parsedDecision === null || Array.isArray(parsedDecision)) {
    return undefined;
  }
  const clientAnalysis = (parsedDecision as { clientAnalysis?: unknown }).clientAnalysis;
  if (typeof clientAnalysis !== "object" || clientAnalysis === null) {
    return undefined;
  }
  const milestone = (clientAnalysis as { milestone?: unknown }).milestone;
  return typeof milestone === "string" ? milestone : undefined;
}

export const VALID_MILESTONES: ReadonlySet<string> = new Set<Milestone>([
  "payment_intent",
  "payment_confirmed",
  "payment_proof_received",
  "ready_to_start",
]);

/**
 * Non-"none" milestones already reached by a PRIOR turn in this conversation
 * (oldest first, deduped). Originally private to trigger/send-ai-reply.ts,
 * where it feeds SkillInvocationContext.reachedMilestones; extracted here so
 * trigger/schedule-followup.ts's campaign follow-up sequence can reuse the
 * identical logic as its milestone-based stop condition (see SKILL.md §6 —
 * these 4 milestones are exactly the "advanced stage" signals a follow-up
 * must never talk past) instead of a second, potentially-diverging copy.
 */
export async function fetchReachedMilestones(conversationId: string): Promise<Milestone[]> {
  const priorDecisions = await prisma.aiDecision.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { parsedDecision: true },
  });
  const reached: Milestone[] = [];
  for (const d of priorDecisions) {
    const m = extractMilestone(d.parsedDecision);
    if (m && VALID_MILESTONES.has(m) && !reached.includes(m as Milestone)) {
      reached.push(m as Milestone);
    }
  }
  return reached;
}
