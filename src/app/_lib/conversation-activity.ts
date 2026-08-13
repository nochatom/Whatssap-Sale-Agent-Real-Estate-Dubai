import { prisma } from "@/lib/prisma";

export interface HourlyActivity {
  hour: string;
  active: number;
}

/**
 * Distinct conversations with any message in each hour, rolling last 24h.
 * One query for the whole window, bucketed in JS — not 24 separate
 * round trips. Real data either way; this only changes how many
 * connections a single Dashboard load competes for against Supabase's
 * pooler (was a real, reproducible cause of intermittent 500s).
 */
export async function getHourlyConversationActivity(): Promise<HourlyActivity[]> {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  const windowStart = new Date(hourStart.getTime() - 23 * 60 * 60 * 1000);

  const messages = await prisma.message.findMany({
    where: { createdAt: { gte: windowStart } },
    select: { createdAt: true, conversationId: true },
  });

  const buckets = Array.from({ length: 24 }, (_, idx) => {
    const start = new Date(windowStart.getTime() + idx * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const conversationIds = new Set(
      messages.filter((m) => m.createdAt >= start && m.createdAt < end).map((m) => m.conversationId),
    );
    return { hour: start.toLocaleTimeString(undefined, { hour: "numeric" }), active: conversationIds.size };
  });

  return buckets;
}
