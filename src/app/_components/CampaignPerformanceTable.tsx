import Link from "next/link";
import type { CampaignStatus } from "@prisma/client";

import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import type { CampaignPerformance } from "../_lib/campaign-performance";
import Badge from "./Badge";

const STATUS_TONE: Record<CampaignStatus, "ok" | "warn" | "neutral"> = {
  ACTIVE: "ok",
  PAUSED: "warn",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
};

const COLUMNS = "1.6fr repeat(4, 0.7fr) 1.2fr";

/**
 * Same visual result as the Tailwind/shadcn version this was ported from,
 * rebuilt with inline styles + ui-tokens.ts. Status badge reuses the
 * existing Badge component instead of a new one-off. No responsive
 * column-hiding — this app has no breakpoint system anywhere else, so
 * this stays as simple as every other table already in it.
 */
export default function CampaignPerformanceTable({ campaigns }: { campaigns: CampaignPerformance[] }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Campaign Performance</h2>
          <p style={{ color: colors.mutedText, fontSize: 13, margin: "4px 0 0" }}>Delivery and engagement per campaign</p>
        </div>
        <Link href="/campaigns" style={{ color: colors.mutedText, fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
          View all
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>No campaigns yet.</p>
      ) : (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLUMNS,
              gap: space.xs,
              padding: `0 0 ${space.xxs}px`,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.6px",
              textTransform: "uppercase",
              color: colors.mutedText,
            }}
          >
            <span>Campaign</span>
            <span style={{ textAlign: "right" }}>Leads</span>
            <span style={{ textAlign: "right" }}>Sent</span>
            <span style={{ textAlign: "right" }}>Replies</span>
            <span style={{ textAlign: "right" }}>Follow-ups</span>
            <span>Progress</span>
          </div>

          {campaigns.map((c) => (
            <div
              key={c.id}
              style={{
                display: "grid",
                gridTemplateColumns: COLUMNS,
                alignItems: "center",
                gap: space.xs,
                padding: "14px 0",
                borderTop: `1px solid ${colors.hairline}`,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: colors.ink }}>{c.name}</span>
                <div>
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                </div>
              </div>
              <span style={{ textAlign: "right", fontSize: 13, color: colors.mutedText }}>{c.leads.toLocaleString()}</span>
              <span style={{ textAlign: "right", fontSize: 13, color: colors.mutedText }}>{c.sent.toLocaleString()}</span>
              <span style={{ textAlign: "right", fontSize: 13, color: colors.mutedText }}>{c.replies.toLocaleString()}</span>
              <span style={{ textAlign: "right", fontSize: 13, color: colors.mutedText }}>{c.followUps.toLocaleString()}</span>
              <div style={{ display: "flex", alignItems: "center", gap: space.xxs }}>
                <div style={{ flex: 1, height: 6, borderRadius: 9999, background: colors.hairline, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 9999, background: colors.primary, width: `${c.progress}%` }} />
                </div>
                <span style={{ width: 36, textAlign: "right", fontSize: 12, fontWeight: 500, color: colors.ink }}>
                  {c.progress}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
