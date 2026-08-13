import { CalendarClock } from "lucide-react";

import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import { formatDue, type FollowUpUrgency, type UpcomingFollowUp } from "../_lib/upcoming-followups";
import Badge from "./Badge";

const STATUS: Record<FollowUpUrgency, { tone: "ok" | "warn" | "neutral" | "primary"; label: string }> = {
  overdue: { tone: "warn", label: "Overdue" },
  due: { tone: "primary", label: "Due" },
  upcoming: { tone: "neutral", label: "Upcoming" },
};

/**
 * Same visual result as the Tailwind/shadcn version this was ported from,
 * rebuilt with inline styles + ui-tokens.ts. See upcoming-followups.ts for
 * why "status" here is derived urgency, not FollowUp.status.
 */
export default function UpcomingFollowUps({ followUps }: { followUps: UpcomingFollowUp[] }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Follow-ups</h2>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.mutedText }}>
          <CalendarClock size={16} />
          Next 48h
        </span>
      </div>

      {followUps.length === 0 ? (
        <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>No follow-ups due in the next 48h.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {followUps.map((f) => {
            const status = STATUS[f.urgency];
            return (
              <li
                key={f.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space.xxs,
                  padding: "14px 0",
                  borderTop: `1px solid ${colors.hairline}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.leadLabel}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: colors.mutedText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.campaignLabel}
                  </p>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 12, color: colors.mutedText }}>{formatDue(f.scheduledFor)}</p>
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
