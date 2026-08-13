import { prisma } from "@/lib/prisma";

export interface DailyActivity {
  day: string;
  messages: number;
  replies: number;
}

/** Real Message counts per day, last 7 days (today inclusive). No mock data. */
export async function getWeeklySalesActivity(): Promise<DailyActivity[]> {
  const now = new Date();
  const dayBoundaries = Array.from({ length: 7 }, (_, idx) => {
    const daysAgo = 6 - idx;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysAgo);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  });

  return Promise.all(
    dayBoundaries.map(async ({ start, end }) => {
      const [messages, replies] = await Promise.all([
        prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: start, lt: end } } }),
        prisma.message.count({ where: { direction: "INBOUND", createdAt: { gte: start, lt: end } } }),
      ]);
      return { day: start.toLocaleDateString(undefined, { weekday: "short" }), messages, replies };
    }),
  );
}
