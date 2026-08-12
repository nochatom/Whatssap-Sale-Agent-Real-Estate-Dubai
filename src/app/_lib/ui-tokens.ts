import type { CSSProperties } from "react";

/**
 * Single shared visual system for the whole app (root, /leads, /campaigns,
 * /conversations, /webhook-status, Nav). Sourced from DESIGN.md (linear.app
 * template) — near-black canvas, one lavender accent, actually-rounded
 * corners (Linear uses rounded.md/8px on buttons, the opposite of the prior
 * Ferrari theme's sharp 0px). All values below trace to a DESIGN.md token
 * except `semanticWarning` — the file has no error/warning color at all
 * (its own Known Gaps section says so: "Form-field error and validation
 * styling is not visible on the inspected pages," and "Linear avoids
 * saturated reds... on the marketing canvas"). That one color is a
 * standard dark-UI red, not sourced from the file — flagged here rather
 * than silently presented as if it were.
 */
export const colors = {
  primary: "#5e6ad2", // colors.primary
  onPrimary: "#ffffff", // colors.on-primary
  ink: "#f7f8f8", // colors.ink
  body: "#d0d6e0", // colors.ink-muted
  mutedText: "#8a8f98", // colors.ink-subtle — ~6.6:1 on canvas, passes WCAG AA
  canvas: "#010102", // colors.canvas
  canvasElevated: "#0f1011", // colors.surface-1
  hairline: "#23252a", // colors.hairline
  hairlineStrong: "#34343a", // colors.hairline-strong
  semanticInfo: "#5e6ad2", // reuses colors.primary — the file defines no separate info color
  semanticSuccess: "#27a644", // colors.semantic-success — the file's only semantic color
  semanticWarning: "#eb5757", // NOT in DESIGN.md — see file-level note above
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
