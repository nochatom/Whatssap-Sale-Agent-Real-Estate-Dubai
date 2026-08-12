import { prisma } from "@/lib/prisma";
import { colors, space, sectionStyle, fieldLabel } from "../_lib/ui-tokens";

/** Read-only. Server component querying existing Conversation/Lead/Campaign/Message models directly. */
export default async function ConversationsPage() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      lead: { select: { phoneE164: true, name: true } },
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, body: true, type: true } },
    },
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 ${space.sm}px` }}>Conversations</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.sm}px` }}>
        Read-only — most recent 100. A conversation with no campaign is organic inbound.
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
              return (
                <tr key={conv.id} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                  <td style={{ padding: "10px 0", color: colors.ink }}>
                    {conv.lead.phoneE164}
                    {conv.lead.name ? ` (${conv.lead.name})` : ""}
                  </td>
                  <td style={{ color: colors.body }}>{conv.campaign?.name ?? "— organic —"}</td>
                  <td style={{ color: colors.body }}>{conv.status}</td>
                  <td style={{ color: colors.body, maxWidth: 280 }}>
                    {last ? `[${last.direction.toLowerCase()}/${last.type}] ${last.body ?? ""}` : "—"}
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
