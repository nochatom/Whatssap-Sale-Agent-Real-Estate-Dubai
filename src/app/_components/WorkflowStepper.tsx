import Link from "next/link";

import { colors, space } from "../_lib/ui-tokens";

export type WorkflowStep = "import" | "select" | "send";

const STEPS: { id: WorkflowStep; label: string; description: string; href: string }[] = [
  { id: "import", label: "Import", description: "Upload and prepare contacts", href: "/leads/import" },
  { id: "select", label: "Select", description: "Choose the contacts", href: "/leads" },
  { id: "send", label: "Send", description: "Prepare and send the campaign", href: "/leads/send" },
];

/**
 * Shared across the three-stage Import → Select → Send workflow so each
 * page reads as part of the same flow while staying independently
 * usable — every step is a real link, not a fake progress indicator.
 */
export default function WorkflowStepper({ current }: { current: WorkflowStep }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <nav
      aria-label="Import, select, send workflow"
      style={{
        display: "flex",
        alignItems: "center",
        marginBottom: space.lg,
      }}
    >
      {STEPS.map((step, i) => {
        const isCurrent = step.id === current;
        const isDone = i < currentIndex;
        const dotColor = isCurrent || isDone ? colors.primary : colors.hairlineStrong;
        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <Link href={step.href} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 9999,
                  flexShrink: 0,
                  fontSize: 12,
                  fontWeight: 700,
                  background: isCurrent ? colors.primary : "transparent",
                  color: isCurrent ? colors.onPrimary : dotColor,
                  border: `1.5px solid ${dotColor}`,
                }}
              >
                {i + 1}
              </span>
              <span>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: isCurrent ? colors.ink : colors.mutedText,
                  }}
                >
                  {step.label}
                </span>
                <span style={{ display: "block", fontSize: 11, color: colors.mutedText }}>{step.description}</span>
              </span>
            </Link>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1.5,
                  margin: `0 ${space.xs}px`,
                  background: isDone ? colors.primary : colors.hairline,
                }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
