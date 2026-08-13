import { prisma } from "@/lib/prisma";

/**
 * Not FollowUp.status (that's send lifecycle: PENDING/SENT/CANCELLED).
 * This is derived from the real scheduledFor timestamp — only PENDING
 * follow-ups are "upcoming" at all; a sent or cancelled one isn't due.
 */
export type FollowUpUrgency = "overdue" | "due" | "upcoming";

export interface UpcomingFollowUp {
  id: string;
  leadLabel: string;
  campaignLabel: string;
  scheduledFor: Date;
  urgency: FollowUpUrgency;
}

// "Due soon" vs "upcoming" cutoff — an explicit editorial choice (not from
// any spec), documented rather than presented as a fixed business rule.
const DUE_SOON_WINDOW_MS = 6 * 60 * 60 * 1000;
// Matches the "Next 48h" header this feeds.
const WINDOW_MS = 48 * 60 * 60 * 1000;

export async function getUpcomingFollowUps(limit = 6): Promise<UpcomingFollowUp[]> {
  const now = new Date();
  const followUps = await prisma.followUp.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: new Date(now.getTime() + WINDOW_MS) },
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: {
      id: true,
      scheduledFor: true,
      lead: { select: { name: true, phoneE164: true } },
      conversation: { select: { campaign: { select: { name: true } } } },
    },
  });

  return followUps.map((f) => {
    const diffMs = f.scheduledFor.getTime() - now.getTime();
    const urgency: FollowUpUrgency = diffMs < 0 ? "overdue" : diffMs <= DUE_SOON_WINDOW_MS ? "due" : "upcoming";
    return {
      id: f.id,
      leadLabel: f.lead.name ?? f.lead.phoneE164,
      campaignLabel: f.conversation.campaign?.name ?? "Organic",
      scheduledFor: f.scheduledFor,
      urgency,
    };
  });
}

export function formatDue(scheduledFor: Date, now: Date = new Date()): string {
  const diffMs = scheduledFor.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(hours / 24);

  const label = minutes < 60 ? `${minutes}m` : hours < 24 ? `${hours}h` : `${days}d`;
  return overdue ? `${label} overdue` : `in ${label}`;
}
