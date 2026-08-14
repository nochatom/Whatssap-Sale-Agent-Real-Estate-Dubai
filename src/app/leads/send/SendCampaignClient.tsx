"use client";

import { useState } from "react";
import Link from "next/link";

import Badge from "../../_components/Badge";
import WorkflowStepper from "../../_components/WorkflowStepper";
import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../../_lib/ui-tokens";

interface Campaign {
  id: string;
  name: string;
  status: string;
  templateName: string;
  templateStatus: string;
}

interface Lead {
  id: string;
  phoneE164: string;
  name: string | null;
}

type ComplianceFailure =
  | "suppression"
  | "opt_out"
  | "campaign_inactive"
  | "daily_budget_exceeded"
  | "idempotency_conflict"
  | "service_window_closed"
  | "template_not_approved";

type SendOutboundResult = { sent: false; blockedBy: ComplianceFailure } | { sent: true; waMessageId: string; messageId: string };

type SendOutcome = { outcome: "returned" | "blocked_before_send" | "error"; result?: SendOutboundResult; message?: string };

/**
 * Uses the existing single-lead /api/leads/send route, called once per
 * selected lead — the same compliance-gated sendOutbound() path every send
 * in this app already goes through. No new send logic, no batch API added.
 * A lead not actually linked to the chosen campaign surfaces the API's own
 * existing "No conversation links this lead to this campaign" error rather
 * than being silently pre-filtered — real backend behavior, not hidden.
 */
export default function SendCampaignClient({
  campaigns,
  leads,
}: {
  campaigns: Campaign[];
  leads: Lead[];
}) {
  const [campaignId, setCampaignId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<Record<string, SendOutcome>>({});

  const selectedCampaign = campaigns.find((c) => c.id === campaignId) ?? null;

  async function handleConfirmSend() {
    if (!selectedCampaign) return;
    setSending(true);
    setSendResults({});
    for (const lead of leads) {
      try {
        const res = await fetch("/api/leads/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, campaignId: selectedCampaign.id }),
        });
        const data = await res.json();
        // The route's early-return paths (missing fields, no conversation
        // linking this lead to the campaign, campaign not found) reply with
        // a plain {error} shape, not {outcome, result} — normalize those
        // here so the table shows the real reason instead of falling
        // through to the compliance-gate branch with nothing to show.
        const outcome = res.ok ? data : { outcome: "error", message: data.error ?? `Request failed (HTTP ${res.status})` };
        setSendResults((prev) => ({ ...prev, [lead.id]: outcome }));
      } catch (err) {
        setSendResults((prev) => ({
          ...prev,
          [lead.id]: { outcome: "error", message: err instanceof Error ? err.message : String(err) },
        }));
      }
    }
    setSending(false);
    setConfirming(false);
  }

  if (leads.length === 0) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
        <WorkflowStepper current="send" />
        <h1 style={{ fontSize: 26, fontWeight: 500, margin: `0 0 ${space.xxs}px` }}>Send Campaign</h1>
        <section style={sectionStyle}>
          <p style={{ color: colors.mutedText, fontSize: 14, margin: 0 }}>
            No leads selected.{" "}
            <Link href="/leads" style={{ color: colors.primary }}>
              Go to Select Leads
            </Link>{" "}
            first.
          </p>
        </section>
      </main>
    );
  }

  const resultsCount = Object.keys(sendResults).length;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <WorkflowStepper current="send" />

      <h1 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "0.2px", margin: `0 0 ${space.xxs}px` }}>Send Campaign</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.xs}px` }}>
        Pick a campaign, review, and send the opener to the selected leads.
      </p>
      <p style={{ fontSize: 14, fontWeight: 600, color: colors.ink, margin: `0 0 ${space.md}px` }}>
        {leads.length} recipient{leads.length === 1 ? "" : "s"}
        {selectedCampaign ? <> → <span style={{ color: colors.primary }}>{selectedCampaign.name}</span></> : null}
      </p>

      <section style={{ ...sectionStyle, marginBottom: space.lg }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>1. Campaign</h2>
        <label style={{ ...fieldLabel, display: "block", margin: `${space.xs}px 0` }}>
          Select campaign
          <select
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              setConfirming(false);
            }}
            style={{ ...fieldInput, display: "block", marginTop: 4, width: 320 }}
          >
            <option value="">— select —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {selectedCampaign && (
          <div style={{ display: "flex", gap: space.xs, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: colors.mutedText, fontSize: 13 }}>Template:</span>
            <span style={{ color: colors.ink, fontSize: 13, fontFamily: "monospace" }}>{selectedCampaign.templateName}</span>
            <Badge tone={selectedCampaign.templateStatus === "APPROVED" ? "ok" : "warn"}>{selectedCampaign.templateStatus}</Badge>
            <Badge tone={selectedCampaign.status === "ACTIVE" ? "ok" : "neutral"}>{selectedCampaign.status}</Badge>
          </div>
        )}
      </section>

      <section style={{ ...sectionStyle, marginBottom: space.lg }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>2. Recipients</h2>
        <p style={{ ...fieldLabel, margin: `4px 0 ${space.xs}px` }}>{leads.length} lead{leads.length === 1 ? "" : "s"} selected</p>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", maxHeight: 200, overflowY: "auto" }}>
          {leads.map((lead) => (
            <li key={lead.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${colors.hairline}`, fontSize: 13 }}>
              <span style={{ color: colors.ink }}>{lead.phoneE164}</span>
              <span style={{ color: colors.mutedText }}>{lead.name ?? "—"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ ...sectionStyle, opacity: selectedCampaign ? 1 : 0.5 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>3. Confirm &amp; send</h2>
        {!selectedCampaign && (
          <p style={{ color: colors.mutedText, fontSize: 13, margin: `4px 0 0` }}>Pick a campaign above first.</p>
        )}

        {!confirming ? (
          <button
            disabled={!selectedCampaign || sending}
            onClick={() => setConfirming(true)}
            style={{ ...buttonStyle("hero", !selectedCampaign || sending), marginTop: space.sm }}
          >
            Review send
          </button>
        ) : (
          <div style={{ marginTop: space.sm }}>
            <p style={{ color: colors.ink, fontSize: 14, margin: `0 0 ${space.xs}px` }}>
              Send the opener for <strong>{selectedCampaign?.name}</strong> to <strong>{leads.length}</strong> lead
              {leads.length === 1 ? "" : "s"}?
            </p>
            <div style={{ display: "flex", gap: space.xs }}>
              <button disabled={sending} onClick={handleConfirmSend} style={buttonStyle("hero", sending)}>
                {sending ? `Sending… (${resultsCount}/${leads.length})` : "Confirm & Send"}
              </button>
              <button disabled={sending} onClick={() => setConfirming(false)} style={buttonStyle("outline", sending)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {resultsCount > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: space.md }}>
            <thead>
              <tr style={fieldLabel}>
                <th align="left" style={{ paddingBottom: space.xxs }}>Phone</th>
                <th align="left">Result</th>
              </tr>
            </thead>
            <tbody>
              {leads
                .filter((lead) => sendResults[lead.id])
                .map((lead) => {
                  const result = sendResults[lead.id]!;
                  return (
                    <tr key={lead.id} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                      <td style={{ padding: "8px 0", color: colors.ink }}>{lead.phoneE164}</td>
                      <td>
                        {result.outcome === "blocked_before_send" ? (
                          <span style={{ color: colors.semanticInfo }}>Blocked (test mode): {result.message}</span>
                        ) : result.outcome === "error" ? (
                          <span style={{ color: colors.semanticWarning }}>Error: {result.message}</span>
                        ) : result.result?.sent ? (
                          <span style={{ color: colors.semanticSuccess }}>Sent — message {result.result.waMessageId}</span>
                        ) : (
                          <span style={{ color: colors.semanticInfo }}>
                            Blocked by compliance gate: {result.result?.blockedBy ?? "unknown"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
