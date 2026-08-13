import {
  TrendingUp,
  TrendingDown,
  Users,
  UserCheck,
  Megaphone,
  Send,
  MessagesSquare,
  Clock,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import type { Kpi } from "../_lib/kpis";

const ICONS: Record<string, LucideIcon> = {
  "total-leads": Users,
  "opted-in": UserCheck,
  "active-campaigns": Megaphone,
  "messages-sent": Send,
  conversations: MessagesSquare,
  "followups-due": Clock,
  "ai-decisions": Sparkles,
};

/**
 * Same visual result as the Tailwind/shadcn version this was ported from,
 * rebuilt with inline styles + ui-tokens.ts. Delta is omitted (not faked)
 * for snapshot metrics — see kpis.ts.
 */
export default function StatCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <div style={{ display: "grid", gap: space.xxs, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
      {kpis.map((kpi) => {
        const Icon = ICONS[kpi.id] ?? Users;
        return (
          <div key={kpi.id} style={{ ...sectionStyle, padding: space.xs }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: colors.canvas,
                  color: colors.mutedText,
                }}
              >
                <Icon size={16} />
              </div>
              {kpi.delta && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    fontSize: 11,
                    fontWeight: 600,
                    color: kpi.delta.positive ? colors.semanticSuccess : colors.semanticWarning,
                  }}
                >
                  {kpi.delta.positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {kpi.delta.label}
                </span>
              )}
            </div>
            <p style={{ margin: "16px 0 0", fontSize: 22, fontWeight: 600, color: colors.ink }}>{kpi.value.toLocaleString()}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: colors.mutedText }}>{kpi.label}</p>
          </div>
        );
      })}
    </div>
  );
}
