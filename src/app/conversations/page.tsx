import { prisma } from "@/lib/prisma";
import Badge from "../_components/Badge";
import { colors, space, sectionStyle, fieldLabel } from "../_lib/ui-tokens";
import { deriveConversationStatus, CONVERSATION_STATUS_DISPLAY } from "../_lib/recent-conversations";

// Queries the DB on every load — must render per-request, not be statically
// prerendered at build time, when no DATABASE_URL is available.
export const dynamic = "force-dynamic";

/**
 * Read-only. Server component querying existing Conversation/Lead/Campaign/
 * Message models directly. Status column uses the same derived status
 * (deriveConversationStatus, real lastInboundAt/lastOutboundAt signal) the
 * Dashboard's Recent Conversations widget already uses — not the raw
 * Conversation.status field, which is never actually set anywhere beyond
 * its "open" default and would show identically for every row.
 */
export default async function ConversationsPage() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      lead: { select: { phoneE164: true, name: true } },
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true } },
    },
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 ${space.sm}px` }}>Conversations</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.sm}px` }}>
        Read-only — most recent 100.
      </p>

      <section style={sectionStyle}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={fieldLabel}>
              <th align="left" style={{ paddingBottom: space.xxs }}>Lead</th>
              <th align="left">Campaign</th>
              <th align="left">Status</th>
              <th align="left">Last message</th>
              <th align="left">Last inbound</th>
              <th align="left">Last outbound</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((conv) => {
              const last = conv.messages[0];
              const status = CONVERSATION_STATUS_DISPLAY[deriveConversationStatus(conv.lastInboundAt, conv.lastOutboundAt)];
              return (
                <tr key={conv.id} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                  <td style={{ padding: "10px 0", color: colors.ink }}>
                    {conv.lead.phoneE164}
                    {conv.lead.name ? ` (${conv.lead.name})` : ""}
                  </td>
                  <td>
                    {conv.campaign ? (
                      <span style={{ color: colors.body }}>{conv.campaign.name}</span>
                    ) : (
                      <Badge tone="neutral">Organic</Badge>
                    )}
                  </td>
                  <td>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td style={{ color: colors.body, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {last ? (last.body ?? `[${last.type}]`) : "—"}
                  </td>
                  <td style={{ color: colors.mutedText, fontSize: 12 }}>
                    {conv.lastInboundAt ? new Date(conv.lastInboundAt).toLocaleString() : "—"}
                  </td>
                  <td style={{ color: colors.mutedText, fontSize: 12 }}>
                    {conv.lastOutboundAt ? new Date(conv.lastOutboundAt).toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
            {conversations.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: colors.mutedText, padding: space.xs }}>
                  No conversations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
