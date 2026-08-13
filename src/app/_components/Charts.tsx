"use client";

import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import type { DailyActivity } from "../_lib/sales-activity";
import type { HourlyActivity } from "../_lib/conversation-activity";

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${colors.hairline}`,
        background: colors.canvasElevated,
        padding: "8px 12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      }}
    >
      <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 500, color: colors.mutedText }}>{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 13, fontWeight: 500, color: colors.ink }}>
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: entry.color }} />
          <span style={{ color: colors.mutedText, textTransform: "capitalize" }}>{entry.name}</span>
          <span style={{ marginLeft: "auto" }}>{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.mutedText }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: color }} />
      {label}
    </span>
  );
}

/**
 * Same visual result as the Tailwind/shadcn + recharts version this was
 * ported from. recharts itself needs no Tailwind — only the color/style
 * values did, and those are now the same ui-tokens.ts tokens every other
 * component uses (colors.primary/semanticSuccess instead of
 * var(--color-chart-1)/var(--color-chart-2)). "Conversions" was dropped —
 * there's no conversion event tracked anywhere in this schema.
 */
export function SalesChart({ data }: { data: DailyActivity[] }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: space.xs }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Sales Activity</h2>
          <p style={{ color: colors.mutedText, fontSize: 13, margin: "4px 0 0" }}>Messages and replies this week</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: space.xs }}>
          <LegendDot color={colors.primary} label="Messages" />
          <LegendDot color={colors.semanticSuccess} label="Replies" />
        </div>
      </div>

      <div style={{ marginTop: space.sm, height: 256, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="fillMessages" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.primary} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.primary} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="fillReplies" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.semanticSuccess} stopOpacity={0.25} />
                <stop offset="95%" stopColor={colors.semanticSuccess} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.hairline} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: colors.mutedText, fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: colors.mutedText, fontSize: 12 }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.hairline }} />
            <Area type="monotone" dataKey="messages" name="messages" stroke={colors.primary} strokeWidth={2.5} fill="url(#fillMessages)" />
            <Area type="monotone" dataKey="replies" name="replies" stroke={colors.semanticSuccess} strokeWidth={2} fill="url(#fillReplies)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ConversationActivityChart({ data }: { data: HourlyActivity[] }) {
  const peak = data.length > 0 ? Math.max(...data.map((d) => d.active)) : 0;

  return (
    <div style={sectionStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.xs }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Conversation Activity</h2>
          <p style={{ color: colors.mutedText, fontSize: 13, margin: "4px 0 0" }}>Active chats by hour</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: colors.ink }}>{peak}</p>
          <p style={{ margin: 0, fontSize: 12, color: colors.mutedText }}>Peak</p>
        </div>
      </div>

      <div style={{ marginTop: space.sm, height: 192, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.hairline} />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fill: colors.mutedText, fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: colors.mutedText, fontSize: 12 }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.hairline }} />
            <Bar dataKey="active" name="active" fill={colors.primary} radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
