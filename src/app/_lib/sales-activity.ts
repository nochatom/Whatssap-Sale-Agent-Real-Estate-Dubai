import { prisma } from "@/lib/prisma";

export interface DailyActivity {
  day: string;
  messages: number;
  replies: number;
}

/**
 * Real Message counts per day, last 7 days (today inclusive). One query
 * for the whole window, bucketed in JS — was 14 separate count() calls.
 */
export async function getWeeklySalesActivity(): Promise<DailyActivity[]> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - 6);

  const messages = await prisma.message.findMany({
    where: { createdAt: { gte: windowStart } },
    select: { createdAt: true, direction: true },
  });

  return Array.from({ length: 7 }, (_, idx) => {
    const start = new Date(windowStart.getTime() + idx * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const dayMessages = messages.filter((m) => m.createdAt >= start && m.createdAt < end);
    return {
      day: start.toLocaleDateString(undefined, { weekday: "short" }),
      messages: dayMessages.filter((m) => m.direction === "OUTBOUND").length,
      replies: dayMessages.filter((m) => m.direction === "INBOUND").length,
    };
  });
}
