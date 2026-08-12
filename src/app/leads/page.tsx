import LeadsClient from "./LeadsClient";

// Reads SENDING_ENABLED at request time — must not be statically prerendered,
// or the safety banner would show whatever this env var was at build time,
// not the actual running server's current value.
export const dynamic = "force-dynamic";

/**
 * Server component so it can read SENDING_ENABLED directly from the server
 * environment (client components can't see non-NEXT_PUBLIC_ env vars) — the
 * test-mode banner reflects the real, current value, not an assumption.
 */
export default function LeadsPage() {
  const sendingEnabled = process.env.SENDING_ENABLED === "true";
  return <LeadsClient sendingEnabled={sendingEnabled} />;
}
