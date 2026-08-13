import Link from "next/link";

import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import { relativeTime } from "../_lib/activity";
import type { DerivedConversationStatus, RecentConversation } from "../_lib/recent-conversations";
import Badge from "./Badge";

const STATUS: Record<DerivedConversationStatus, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  awaiting: { tone: "warn", label: "Awaiting reply" },
  responded: { tone: "ok", label: "Responded" },
  open: { tone: "neutral", label: "Open" },
};

/**
 * Same visual result as the Tailwind/shadcn version this was ported from,
 * rebuilt with inline styles + ui-tokens.ts. Status reuses the existing
 * Badge component; see recent-conversations.ts for why the status values
 * are derived rather than the raw (never-actually-set) status field.
 */
export default function RecentConversations({ conversations }: { conversations: RecentConversation[] }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Recent Conversations</h2>
        <Link href="/conversations" style={{ color: colors.mutedText, fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
          View all
        </Link>
      </div>

      {conversations.length === 0 ? (
        <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>No conversations yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {conversations.map((c) => {
            const status = STATUS[c.status];
            return (
              <li
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space.xxs,
                  padding: "14px 0",
                  borderTop: `1px solid ${colors.hairline}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    borderRadius: 9999,
                    background: colors.canvas,
                    border: `1px solid ${colors.hairline}`,
                    fontSize: 12,
                    fontWeight: 600,
                    color: colors.ink,
                  }}
                >
                  {c.initials}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.xxs }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.leadLabel}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 12, color: colors.mutedText }}>{relativeTime(c.lastActivity)}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: colors.mutedText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.message}
                  </p>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
