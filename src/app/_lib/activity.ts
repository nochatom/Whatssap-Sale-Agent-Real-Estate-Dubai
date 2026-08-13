import { prisma } from "@/lib/prisma";

export type ActivityType = "lead" | "campaign" | "message" | "reply" | "ai" | "followup";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  detail: string;
  time: Date;
}

function leadLabel(lead: { name: string | null; phoneE164: string }): string {
  return lead.name ? `${lead.name} · ${lead.phoneE164}` : lead.phoneE164;
}

/**
 * Merges the most recent events across Lead/Campaign/Message/AiDecision/
 * FollowUp into one timeline — real data, same models every other page
 * already queries, no mock/placeholder content.
 */
export async function getRecentActivity(limit = 8): Promise<ActivityItem[]> {
  const [leads, campaigns, outbound, inbound, aiDecisions, followUps] = await Promise.all([
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, name: true, phoneE164: true, createdAt: true },
    }),
    prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        conversation: { select: { lead: { select: { name: true, phoneE164: true } } } },
      },
    }),
    prisma.message.findMany({
      where: { direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        conversation: { select: { lead: { select: { name: true, phoneE164: true } } } },
      },
    }),
    prisma.aiDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        parseStatus: true,
        conversation: { select: { lead: { select: { name: true, phoneE164: true } } } },
      },
    }),
    prisma.followUp.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        reason: true,
        lead: { select: { name: true, phoneE164: true } },
      },
    }),
  ]);

  const items: ActivityItem[] = [
    ...leads.map((l) => ({
      id: `lead-${l.id}`,
      type: "lead" as const,
      title: "New lead",
      detail: leadLabel(l),
      time: l.createdAt,
    })),
    ...campaigns.map((c) => ({
      id: `campaign-${c.id}`,
      type: "campaign" as const,
      title: "Campaign created",
      detail: c.name,
      time: c.createdAt,
    })),
    ...outbound.map((m) => ({
      id: `message-${m.id}`,
      type: "message" as const,
      title: "Message sent",
      detail: leadLabel(m.conversation.lead),
      time: m.createdAt,
    })),
    ...inbound.map((m) => ({
      id: `reply-${m.id}`,
      type: "reply" as const,
      title: "Reply received",
      detail: leadLabel(m.conversation.lead),
      time: m.createdAt,
    })),
    ...aiDecisions.map((a) => ({
      id: `ai-${a.id}`,
      type: "ai" as const,
      title: a.parseStatus === "SUCCESS" ? "AI decision" : "AI decision (parse failure)",
      detail: leadLabel(a.conversation.lead),
      time: a.createdAt,
    })),
    ...followUps.map((f) => ({
      id: `followup-${f.id}`,
      type: "followup" as const,
      title: "Follow-up scheduled",
      detail: `${leadLabel(f.lead)} — ${f.reason}`,
      time: f.createdAt,
    })),
  ];

  return items.sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, limit);
}

/** "2h ago" / "3d ago" / "just now" — no external date library in this project. */
export function relativeTime(from: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
