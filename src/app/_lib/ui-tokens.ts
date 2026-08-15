import type { CSSProperties } from "react";

/**
 * Single shared visual system for the whole app (root, /leads, /campaigns,
 * /conversations, /webhook-status, Nav). Values are CSS custom-property
 * references, not literal hex — the actual dark/light values live in
 * globals.css (`:root` for dark, `[data-theme="light"]` for light), so a
 * theme switch (see ThemeToggle) needs no re-render of server components.
 *
 * Dark values are the emerald identity adopted 2026-08-15 (see the header
 * comment in globals.css for the full rationale and contrast checks) —
 * near-black green canvas, one emerald accent, same rounded-corner system
 * as before. The light theme keeps its original neutral construction; only
 * the accent-bearing tokens were recolored to match.
 */
export const colors = {
  primary: "var(--color-primary)",
  onPrimary: "var(--color-on-primary)",
  ink: "var(--color-ink)",
  body: "var(--color-body)",
  mutedText: "var(--color-muted)",
  canvas: "var(--color-canvas)",
  canvasElevated: "var(--color-canvas-elevated)",
  hairline: "var(--color-hairline)",
  hairlineStrong: "var(--color-hairline-strong)",
  semanticInfo: "var(--color-info)",
  semanticSuccess: "var(--color-success)",
  semanticWarning: "var(--color-warning)",
};

export const space = { xxs: 8, xs: 16, sm: 24, md: 32, lg: 48 };

export const sectionStyle: CSSProperties = {
  background: colors.canvasElevated,
  border: `1px solid ${colors.hairline}`,
  borderRadius: 12, // rounded.lg
  padding: space.md,
};

export const fieldLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 500, // typography.eyebrow
  letterSpacing: "0.4px",
  color: colors.mutedText,
};

export const fieldInput: CSSProperties = {
  background: colors.canvas,
  color: colors.ink,
  border: `1px solid ${colors.hairline}`,
  borderRadius: 6, // rounded.sm
  padding: "8px 10px",
  height: 36,
  fontSize: 14,
  fontFamily: "inherit",
};

export type ButtonKind = "hero" | "solid" | "outline";

/**
 * One button system for the whole app. Lavender ("hero") is reserved for
 * exactly one role per page — the primary conversion action (Send) — per
 * DESIGN.md's own rule: "used on the brand mark, focus rings, and a few
 * intentional CTAs — never decoratively." Typography matches
 * typography.button exactly: 14px/500, no uppercase, no letter-spacing —
 * a deliberate departure from the previous theme's tracked-uppercase CTAs.
 */
export function buttonStyle(kind: ButtonKind, disabled: boolean, compact = false): CSSProperties {
  const base: CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 8, // rounded.md
    padding: compact ? "6px 14px" : "8px 14px",
    height: compact ? 32 : 38,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background-color 150ms, border-color 150ms",
  };
  if (kind === "hero") {
    return {
      ...base,
      background: disabled ? colors.canvasElevated : colors.primary,
      color: disabled ? colors.mutedText : colors.onPrimary,
      border: `1px solid ${disabled ? colors.hairline : colors.primary}`,
    };
  }
  if (kind === "solid") {
    return {
      ...base,
      background: disabled ? "transparent" : colors.ink,
      color: disabled ? colors.mutedText : colors.canvas,
      border: `1px solid ${disabled ? colors.hairline : colors.ink}`,
    };
  }
  return {
    ...base,
    background: "transparent",
    color: disabled ? colors.mutedText : colors.ink,
    border: `1px solid ${disabled ? colors.hairline : colors.hairlineStrong}`,
  };
}
