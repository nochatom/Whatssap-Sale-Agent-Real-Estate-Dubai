import { prisma } from "@/lib/prisma";
import Badge from "../_components/Badge";
import { colors, space, sectionStyle, fieldLabel } from "../_lib/ui-tokens";

/**
 * Read-only. Server component querying the existing Campaign model
 * directly — no new business logic, no API route needed for a display-only
 * list. Campaign creation still happens the same way it always has
 * (Prisma Studio / direct insert) — this page doesn't add a create flow,
 * which would be new functionality beyond "provide access to."
 */
export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { conversations: true } } },
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 ${space.sm}px` }}>Campaigns</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.sm}px` }}>
        Read-only. Use the Campaign ID shown here on the{" "}
        <a href="/leads" style={{ color: colors.semanticInfo }}>Leads page</a> to import leads into a campaign or send to a
        contact.
      </p>

      <section style={sectionStyle}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={fieldLabel}>
              <th align="left" style={{ paddingBottom: space.xxs }}>Campaign ID</th>
              <th align="left">Name</th>
              <th align="left">Status</th>
              <th align="left">Template</th>
              <th align="left">Sender number</th>
              <th align="left">Daily budget</th>
              <th align="left">Leads linked</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((camp) => (
              <tr key={camp.id} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                <td style={{ padding: "10px 0", fontFamily: "monospace", color: colors.ink }}>{camp.id}</td>
                <td style={{ color: colors.body }}>{camp.name}</td>
                <td>
                  <Badge tone={camp.status === "ACTIVE" ? "ok" : "neutral"}>{camp.status}</Badge>
                </td>
                <td style={{ color: colors.body }}>
                  {camp.templateName}{" "}
                  <Badge tone={camp.templateStatus === "APPROVED" ? "ok" : "warn"}>{camp.templateStatus}</Badge>
                </td>
                <td style={{ color: colors.body }}>{camp.senderPhoneNumberId}</td>
                <td style={{ color: colors.body }}>{camp.dailyBudgetPerNumber}</td>
                <td style={{ color: colors.body }}>{camp._count.conversations}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: colors.mutedText, padding: space.xs }}>
                  No campaigns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
