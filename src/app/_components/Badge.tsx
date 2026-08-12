import { colors } from "../_lib/ui-tokens";

export default function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "warn" | "neutral";
}) {
  const bg = tone === "ok" ? colors.semanticSuccess : tone === "warn" ? colors.semanticWarning : colors.canvas;
  return (
    <span
      style={{
        display: "inline-block",
        background: bg,
        color: colors.ink,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "1px",
        textTransform: "uppercase",
        borderRadius: 9999,
        padding: "3px 10px",
        border: tone === "neutral" ? `1px solid ${colors.hairline}` : "none",
      }}
    >
      {children}
    </span>
  );
}
