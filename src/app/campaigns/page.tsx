import Link from "next/link";

import { prisma } from "@/lib/prisma";
import Badge from "../_components/Badge";
import CopyButton from "../_components/CopyButton";
import { colors, space, sectionStyle, fieldLabel, buttonStyle } from "../_lib/ui-tokens";

// Queries the DB on every load — must render per-request, not be statically
// prerendered at build time, when no DATABASE_URL is available.
export const dynamic = "force-dynamic";

/**
 * Server component querying the existing Campaign model directly. Creation
 * happens via /campaigns/new + POST /api/campaigns (added alongside this),
 * not on this page itself — this stays the read-only list + entry point.
 */
export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { conversations: true } } },
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space.sm, marginBottom: space.sm }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 8px` }}>Campaigns</h1>
          <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>
            Use the Campaign ID shown here on the{" "}
            <a href="/leads" style={{ color: colors.semanticInfo }}>Leads page</a> to import leads into a campaign or send
            to a contact.
          </p>
        </div>
        <Link href="/campaigns/new" style={{ ...buttonStyle("hero", false), display: "inline-flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}>
          New Campaign
        </Link>
      </div>

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
                <td style={{ padding: "10px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: colors.mutedText }}>{camp.id}</span>
                    <CopyButton value={camp.id} />
                  </div>
                </td>
                <td style={{ color: colors.ink, fontWeight: 600 }}>{camp.name}</td>
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
