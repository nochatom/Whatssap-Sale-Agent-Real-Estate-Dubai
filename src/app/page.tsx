import Link from "next/link";
import { Users, Send, MessageSquare, Sparkles, TrendingUp, Clock, type LucideIcon } from "lucide-react";

import { space, colors, sectionStyle } from "./_lib/ui-tokens";
import { getKpis } from "./_lib/kpis";
import { getCampaignPerformance } from "./_lib/campaign-performance";
import { getRecentConversations } from "./_lib/recent-conversations";
import { CONVERSATION_STATUS_DISPLAY } from "./_lib/conversation-status";
import { getRecentActivity, relativeTime } from "./_lib/activity";
import Badge from "./_components/Badge";

// Queries the DB on every load — must render per-request, not be statically
// prerendered at build time, when no DATABASE_URL is available.
export const dynamic = "force-dynamic";

const METRIC_IDS = ["total-leads", "messages-sent", "conversations", "ai-decisions"] as const;
const METRIC_ICONS: Record<(typeof METRIC_IDS)[number], LucideIcon> = {
  "total-leads": Users,
  "messages-sent": Send,
  conversations: MessageSquare,
  "ai-decisions": Sparkles,
};
// Real kpis.ts label for "conversations" is just "Conversations" — this
// stays that way rather than the reference mockup's "Active Conversations"
// label, since this schema has no concept of an active/closed distinction
// for a conversation (see conversation-status.ts) and mislabeling the count
// would misrepresent what it actually is.
const METRIC_LABELS: Partial<Record<(typeof METRIC_IDS)[number], string>> = {
  "ai-decisions": "AI Auto-Decisions",
};

/**
 * Emerald-identity Dashboard, rebuilt 2026-08-15 from a pasted reference
 * mockup (explicit "fully adopt this redesign" instruction) — same real
 * data sources as the previous version (kpis.ts, campaign-performance.ts,
 * recent-conversations.ts, activity.ts), new layout/visual language.
 * The mockup's charts were dropped (not part of the new design), and its
 * decorative top-bar search/bell were omitted rather than shipped as
 * non-functional UI — everything rendered here is backed by a real query.
 */
export default async function DashboardPage() {
  const [kpis, campaignPerformance, recentConversations, activity] = await Promise.all([
    getKpis(),
    getCampaignPerformance(),
    getRecentConversations(5),
    getRecentActivity(6),
  ]);

  const kpiById = Object.fromEntries(kpis.map((k) => [k.id, k]));
  const followUpsDue = kpiById["followups-due"]?.value ?? 0;
  const activeCampaignCount = kpiById["active-campaigns"]?.value ?? 0;
  const featuredCampaign = campaignPerformance.find((c) => c.status === "ACTIVE") ?? null;

  return (
    <main style={{ padding: `${space.lg}px ${space.md}px`, maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ marginBottom: space.md }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.2px", margin: `0 0 4px` }}>Dashboard Overview</h1>
        <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>
          Real-time leads, automated AI routing, and WhatsApp delivery logs.
        </p>
      </div>

      {/* Metric grid */}
      <div style={{ display: "grid", gap: space.xs, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: space.sm }}>
        {METRIC_IDS.map((id) => {
          const kpi = kpiById[id];
          if (!kpi) return null;
          const Icon = METRIC_ICONS[id];
          return (
            <div key={id} style={{ ...sectionStyle, padding: space.xs }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)",
                    color: colors.primary,
                  }}
                >
                  <Icon size={16} />
                </div>
                {kpi.delta && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 10,
                      fontWeight: 600,
                      color: kpi.delta.positive ? colors.semanticSuccess : colors.semanticWarning,
                      background: "color-mix(in srgb, var(--color-primary) 10%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)",
                      borderRadius: 9999,
                      padding: "2px 8px",
                    }}
                  >
                    <TrendingUp size={11} />
                    {kpi.delta.label}
                  </span>
                )}
              </div>
              <p style={{ margin: "16px 0 0", fontSize: 24, fontWeight: 700, color: colors.ink }}>{kpi.value.toLocaleString()}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: colors.mutedText }}>{METRIC_LABELS[id] ?? kpi.label}</p>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gap: space.sm, gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        {/* Left: campaign + conversations */}
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm, minWidth: 0 }}>
          <section style={sectionStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space.xs }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Active Campaigns</h2>
                <p style={{ fontSize: 11, color: colors.mutedText, margin: "2px 0 0" }}>Live broadcasts running on Meta Cloud API</p>
              </div>
              <Badge tone={activeCampaignCount > 0 ? "primary" : "neutral"}>
                {activeCampaignCount} campaign{activeCampaignCount === 1 ? "" : "s"} live
              </Badge>
            </div>

            {featuredCampaign ? (
              <div
                style={{
                  padding: space.xs,
                  borderRadius: 10,
                  background: colors.canvas,
                  border: `1px solid ${colors.hairlineStrong}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: space.xs,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: colors.ink }}>{featuredCampaign.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: colors.mutedText }}>
                    {featuredCampaign.leads} lead{featuredCampaign.leads === 1 ? "" : "s"} targeted · {featuredCampaign.progress}% contacted
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: space.xxs }}>
                  <div style={{ width: 96, height: 8, borderRadius: 9999, background: colors.canvasElevated, border: `1px solid ${colors.hairline}`, overflow: "hidden" }}>
                    <div style={{ width: `${featuredCampaign.progress}%`, height: "100%", background: colors.primary }} />
                  </div>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: colors.body }}>{featuredCampaign.progress}%</span>
                </div>
              </div>
            ) : (
              <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>
                No active campaign.{" "}
                <Link href="/campaigns" style={{ color: colors.primary }}>Create one on Campaigns</Link>.
              </p>
            )}
          </section>

          <section style={sectionStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space.xs }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Conversations In Progress</h2>
              <Link href="/conversations" style={{ fontSize: 12, color: colors.primary, textDecoration: "none" }}>
                Open Inbox
              </Link>
            </div>

            {recentConversations.length === 0 ? (
              <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>No conversations yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentConversations.map((conv) => {
                  const statusDisplay = CONVERSATION_STATUS_DISPLAY[conv.status];
                  return (
                    <div
                      key={conv.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: colors.canvas,
                        border: `1px solid ${colors.hairline}`,
                        gap: space.xs,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            flexShrink: 0,
                            borderRadius: 9999,
                            background: colors.canvasElevated,
                            border: `1px solid ${colors.hairlineStrong}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            color: colors.primary,
                          }}
                        >
                          {conv.initials}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {conv.leadLabel}
                          </p>
                          <p style={{ margin: 0, fontSize: 11, color: colors.mutedText, fontFamily: "monospace" }}>
                            {relativeTime(conv.lastActivity)}
                          </p>
                        </div>
                      </div>
                      <Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right: activity + follow-ups */}
        <section style={{ ...sectionStyle, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space.xs }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Live Activity</h2>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: colors.primary, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: colors.primary }} />
              Live
            </span>
          </div>

          {activity.length === 0 ? (
            <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>No activity yet.</p>
          ) : (
            <div style={{ position: "relative", paddingLeft: 18 }}>
              <div style={{ position: "absolute", left: 5, top: 4, bottom: 4, width: 1, background: colors.hairlineStrong }} />
              <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                {activity.map((item) => (
                  <div key={item.id} style={{ position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: -18,
                        top: 3,
                        width: 10,
                        height: 10,
                        borderRadius: 9999,
                        background: colors.canvas,
                        border: `2px solid ${colors.primary}`,
                      }}
                    />
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink }}>{item.title}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: colors.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.detail}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: colors.mutedText }}>{relativeTime(item.time)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: space.sm, paddingTop: space.xs, borderTop: `1px solid ${colors.hairline}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: colors.body }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Clock size={14} />
              Next 48h Follow-ups
            </span>
            <span style={{ fontWeight: 700, color: colors.ink }}>{followUpsDue} due</span>
          </div>
        </section>
      </div>
    </main>
  );
}
