import LeadsClient from "./LeadsClient";

/**
 * Server component so it can read SENDING_ENABLED directly from the server
 * environment (client components can't see non-NEXT_PUBLIC_ env vars) — the
 * test-mode banner reflects the real, current value, not an assumption.
 */
export default function LeadsPage() {
  const sendingEnabled = process.env.SENDING_ENABLED === "true";
  return <LeadsClient sendingEnabled={sendingEnabled} />;
}
