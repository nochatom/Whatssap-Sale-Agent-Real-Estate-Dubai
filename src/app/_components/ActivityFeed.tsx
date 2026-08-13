import {
  UserPlus,
  Megaphone,
  Send,
  CornerUpLeft,
  Sparkles,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";

import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import { relativeTime, type ActivityItem, type ActivityType } from "../_lib/activity";

const CONFIG: Record<ActivityType, { icon: LucideIcon; color: string }> = {
  lead: { icon: UserPlus, color: colors.semanticSuccess },
  campaign: { icon: Megaphone, color: colors.primary },
  message: { icon: Send, color: colors.mutedText },
  reply: { icon: CornerUpLeft, color: colors.semanticSuccess },
  ai: { icon: Sparkles, color: colors.primary },
  followup: { icon: CalendarClock, color: colors.mutedText },
};

/**
 * Same visual result as the Tailwind/shadcn version this was ported from,
 * rebuilt with inline styles + ui-tokens.ts to match every other component
 * in this app — no Tailwind, no cn(), no new CSS-variable scheme.
 */
export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Recent Activity</h2>
        {items.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.semanticSuccess }}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: colors.semanticSuccess }} />
            Live
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p style={{ color: colors.mutedText, fontSize: 13, margin: 0 }}>No activity yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 15,
              top: 24,
              bottom: 24,
              width: 1,
              background: colors.hairline,
            }}
          />
          {items.map((item) => {
            const { icon: Icon, color } = CONFIG[item.type];
            return (
              <li key={item.id} style={{ position: "relative", display: "flex", gap: space.xxs, padding: "10px 0" }}>
                <div
                  style={{
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                    borderRadius: 9999,
                    background: colors.canvas,
                    color,
                    boxShadow: `0 0 0 4px ${colors.canvasElevated}`,
                  }}
                >
                  <Icon size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.xxs }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </p>
                    <span style={{ flexShrink: 0, fontSize: 12, color: colors.mutedText }}>{relativeTime(item.time)}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: colors.mutedText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
