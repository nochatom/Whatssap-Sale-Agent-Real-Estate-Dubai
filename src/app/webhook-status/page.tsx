import { colors, space, sectionStyle, fieldLabel } from "../_lib/ui-tokens";

interface EnvCheck {
  name: string;
  set: boolean;
  note: string;
}

/**
 * Server component. Reads process.env directly on the server and renders
 * only booleans (set / not set) — actual values are never read into a
 * variable that could reach the client, let alone rendered.
 */
export default function WebhookStatusPage() {
  const checks: EnvCheck[] = [
    { name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", set: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, note: "Required for GET verification" },
    { name: "WHATSAPP_APP_SECRET", set: !!process.env.WHATSAPP_APP_SECRET, note: "Required to validate POST signatures" },
    { name: "WHATSAPP_ACCESS_TOKEN", set: !!process.env.WHATSAPP_ACCESS_TOKEN, note: "Required before any send is attempted" },
    { name: "WHATSAPP_PHONE_NUMBER_ID", set: !!process.env.WHATSAPP_PHONE_NUMBER_ID, note: "Meta's sender phone_number_id" },
    { name: "WHATSAPP_TEMPLATE_LANGUAGE", set: !!process.env.WHATSAPP_TEMPLATE_LANGUAGE, note: "Required for template (campaign opener) sends" },
    { name: "TRIGGER_SECRET_KEY", set: !!process.env.TRIGGER_SECRET_KEY, note: "Required for the webhook route to hand inbound messages to Trigger.dev" },
  ];

  const sendingEnabled = process.env.SENDING_ENABLED === "true";

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 ${space.sm}px` }}>WhatsApp Webhook / Status</h1>

      <section style={{ ...sectionStyle, marginBottom: space.lg }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: `0 0 ${space.xxs}px` }}>Endpoint</h2>
        <p style={{ fontFamily: "monospace", fontSize: 14, color: colors.ink, margin: 0 }}>
          POST/GET /api/webhooks/whatsapp
        </p>
        <p style={{ color: colors.mutedText, fontSize: 13, marginTop: space.xxs }}>
          GET handles Meta&apos;s verification challenge. POST validates the X-Hub-Signature-256 header and hands
          valid inbound messages to the existing handle-inbound task.
        </p>
      </section>

      <section style={{ ...sectionStyle, marginBottom: space.lg }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: `0 0 ${space.xxs}px` }}>Sending status</h2>
        <div
          role="status"
          style={{
            borderLeft: `4px solid ${sendingEnabled ? colors.semanticWarning : colors.semanticInfo}`,
            padding: `${space.xxs}px ${space.xs}px`,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {sendingEnabled
            ? "SENDING_ENABLED = \"true\" — real WhatsApp sends are possible."
            : "SENDING_ENABLED is not set — no real WhatsApp message can be sent, regardless of any other configuration."}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: `0 0 ${space.xxs}px` }}>Environment variables</h2>
        <p style={{ color: colors.mutedText, fontSize: 12, margin: `0 0 ${space.xs}px` }}>
          Presence only — values are never displayed here or sent to the browser.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={fieldLabel}>
              <th align="left" style={{ paddingBottom: space.xxs }}>Variable</th>
              <th align="left">Status</th>
              <th align="left">Used for</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((chk) => (
              <tr key={chk.name} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                <td style={{ padding: "8px 0", fontFamily: "monospace", color: colors.ink }}>{chk.name}</td>
                <td style={{ color: chk.set ? colors.semanticSuccess : colors.semanticWarning, fontWeight: 700 }}>
                  {chk.set ? "SET" : "NOT SET"}
                </td>
                <td style={{ color: colors.mutedText }}>{chk.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
