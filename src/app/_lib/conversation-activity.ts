import { prisma } from "@/lib/prisma";

export interface HourlyActivity {
  hour: string;
  active: number;
}

/** Distinct conversations with any message in each hour, rolling last 24h. Real data. */
export async function getHourlyConversationActivity(): Promise<HourlyActivity[]> {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);

  const buckets = Array.from({ length: 24 }, (_, idx) => {
    const start = new Date(hourStart.getTime() - (23 - idx) * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end };
  });

  return Promise.all(
    buckets.map(async ({ start, end }) => {
      const messages = await prisma.message.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: { conversationId: true },
      });
      return {
        hour: start.toLocaleTimeString(undefined, { hour: "numeric" }),
        active: new Set(messages.map((m) => m.conversationId)).size,
      };
    }),
  );
}
