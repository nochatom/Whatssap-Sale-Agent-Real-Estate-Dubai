"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../../_lib/ui-tokens";

type TemplateStatus = "PENDING" | "APPROVED" | "REJECTED";
type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

/** Every field here maps to a real, existing Campaign column — nothing invented. */
export default function NewCampaignClient({ defaultSenderPhoneNumberId }: { defaultSenderPhoneNumberId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateStatus, setTemplateStatus] = useState<TemplateStatus>("PENDING");
  const [status, setStatus] = useState<CampaignStatus>("DRAFT");
  const [dailyBudgetPerNumber, setDailyBudgetPerNumber] = useState("50");
  const [senderPhoneNumberId, setSenderPhoneNumberId] = useState(defaultSenderPhoneNumberId);
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetNumber = Number(dailyBudgetPerNumber);
  const canSubmit = name.trim() && templateName.trim() && senderPhoneNumberId.trim() && Number.isFinite(budgetNumber) && budgetNumber >= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          templateName: templateName.trim(),
          templateStatus,
          status,
          dailyBudgetPerNumber: budgetNumber,
          senderPhoneNumberId: senderPhoneNumberId.trim(),
          followUpDelayMinutes: followUpDelayMinutes.trim() ? Number(followUpDelayMinutes) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create campaign");
      router.push("/campaigns");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <Link href="/campaigns" style={{ color: colors.mutedText, fontSize: 13, textDecoration: "none" }}>
        ← Campaigns
      </Link>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `${space.xs}px 0 ${space.xxs}px` }}>New Campaign</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.md}px` }}>
        Fields match the existing Campaign model exactly.
      </p>

      {error && (
        <div
          style={{
            borderLeft: `4px solid ${colors.semanticWarning}`,
            background: colors.canvasElevated,
            padding: `${space.xxs}px ${space.xs}px`,
            marginBottom: space.md,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <section style={{ ...sectionStyle, marginBottom: space.md }}>
          <label style={{ ...fieldLabel, display: "block", marginBottom: space.xs }}>
            Campaign name *
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} placeholder="e.g. Spring Property Launch" />
          </label>

          <label style={{ ...fieldLabel, display: "block", marginBottom: space.xs }}>
            Template name *
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} placeholder="Meta-approved template name" />
          </label>

          <div style={{ display: "flex", gap: space.sm, marginBottom: space.xs }}>
            <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
              Template status
              <select value={templateStatus} onChange={(e) => setTemplateStatus(e.target.value as TemplateStatus)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }}>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </label>
            <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
              Campaign status
              <select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }}>
                <option value="DRAFT">DRAFT</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="PAUSED">PAUSED</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </label>
          </div>

          <label style={{ ...fieldLabel, display: "block", marginBottom: space.xs }}>
            Sender phone number ID *
            <input value={senderPhoneNumberId} onChange={(e) => setSenderPhoneNumberId(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%", fontFamily: "monospace" }} placeholder="Meta phone_number_id" />
          </label>

          <div style={{ display: "flex", gap: space.sm }}>
            <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
              Daily budget per number *
              <input type="number" min={0} value={dailyBudgetPerNumber} onChange={(e) => setDailyBudgetPerNumber(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} />
            </label>
            <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
              Follow-up delay (minutes)
              <input type="number" min={0} value={followUpDelayMinutes} onChange={(e) => setFollowUpDelayMinutes(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} placeholder="optional" />
            </label>
          </div>
        </section>

        <button type="submit" disabled={!canSubmit || busy} style={buttonStyle("hero", !canSubmit || busy)}>
          {busy ? "Creating…" : "Create Campaign"}
        </button>
      </form>
    </main>
  );
}
