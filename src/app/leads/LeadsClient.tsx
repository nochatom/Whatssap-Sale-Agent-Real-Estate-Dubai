"use client";

import { useState } from "react";

import Badge from "../_components/Badge";
import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../_lib/ui-tokens";

interface PreviewRow {
  row: number;
  phoneRaw: string;
  name: string | null;
  status: "ok" | "invalid_phone" | "duplicate_in_file";
  e164?: string;
  detail?: string;
}

interface ImportResult {
  mode: "imported";
  totalRows: number;
  created: number;
  rejected: number;
  conversationsCreated: number;
  results: { row: number; phoneRaw: string; status: string; detail?: string; leadId?: string }[];
}

interface Lead {
  id: string;
  phoneE164: string;
  name: string | null;
  optedIn: boolean;
  createdAt: string;
  conversations: { id: string; campaignId: string | null }[];
}

type SendOutcome = { outcome: "returned" | "blocked_before_send" | "error"; result?: unknown; message?: string };

export default function LeadsClient({ sendingEnabled }: { sendingEnabled: boolean }) {
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [defaultCountry, setDefaultCountry] = useState("AE");
  const [preview, setPreview] = useState<{ totalRows: number; rows: PreviewRow[] } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<Record<string, SendOutcome>>({});
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    setPreview(null);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function handlePreview() {
    if (!csvContent) return;
    setBusy("preview");
    setError(null);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csvContent, defaultCountry, confirm: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (!csvContent) return;
    setBusy("import");
    setError(null);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csvContent, campaignId: campaignId || undefined, defaultCountry, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportResult(data);
      await loadLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadLeads() {
    const qs = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    const res = await fetch(`/api/leads${qs}`);
    const data = await res.json();
    setLeads(data.leads ?? []);
  }

  async function handleSend(leadId: string) {
    if (!campaignId) {
      setError("Enter a campaignId before sending — the Send call needs to know which campaign's template to use.");
      return;
    }
    setBusy(`send-${leadId}`);
    try {
      const res = await fetch("/api/leads/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, campaignId }),
      });
      const data = await res.json();
      setSendResults((prev) => ({ ...prev, [leadId]: data }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <h1 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "0.2px", margin: `0 0 ${space.sm}px` }}>
        Leads &amp; Campaign Test Console
      </h1>

      <div
        role="status"
        style={{
          borderLeft: `4px solid ${sendingEnabled ? colors.semanticWarning : colors.semanticInfo}`,
          background: colors.canvasElevated,
          padding: `${space.xxs}px ${space.xs}px`,
          marginBottom: space.md,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.4px",
        }}
      >
        {sendingEnabled
          ? "SENDING_ENABLED IS \"TRUE\" ON THIS SERVER — SEND WILL ATTEMPT A REAL WHATSAPP MESSAGE."
          : "LOCAL / TEST MODE — SENDING_ENABLED IS NOT SET. NO REAL WHATSAPP MESSAGE CAN BE SENT FROM THIS PAGE."}
      </div>

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

      <section id="csv-import" style={{ ...sectionStyle, marginBottom: space.lg }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Import leads</h2>
        <p style={{ color: colors.mutedText, fontSize: 13, margin: `4px 0 ${space.sm}px` }}>
          CSV with a <code>phone</code> column, optionally <code>name</code>.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          style={{ color: colors.ink, fontSize: 13, display: "block", marginBottom: space.xxs }}
        />
        {fileName && <p style={{ color: colors.mutedText, fontSize: 12, margin: `0 0 ${space.xs}px` }}>{fileName}</p>}

        <label style={{ ...fieldLabel, display: "block", marginBottom: space.xs }}>
          Campaign ID (required for Send){" "}
          <input
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={{ ...fieldInput, width: 280, display: "block", marginTop: 4 }}
            placeholder="e.g. cmsnbxbev0000oxbodc46ur4k"
          />
        </label>

        <div style={{ display: "flex", gap: space.xs, marginBottom: space.sm }}>
          <button disabled={!csvContent || busy !== null} onClick={handlePreview} style={buttonStyle("outline", !csvContent || busy !== null)}>
            {busy === "preview" ? "Previewing…" : "Preview"}
          </button>
          <button disabled={!preview || busy !== null} onClick={handleImport} style={buttonStyle("solid", !preview || busy !== null)}>
            {busy === "import" ? "Importing…" : "Import"}
          </button>
        </div>

        <details style={{ marginBottom: space.sm }}>
          <summary style={{ ...fieldLabel, cursor: "pointer", listStyle: "none" }}>Options</summary>
          <div style={{ display: "flex", gap: space.xs, marginTop: space.xxs, flexWrap: "wrap" }}>
            <label style={fieldLabel}>
              Country{" "}
              <input value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value)} style={{ ...fieldInput, width: 56 }} />
            </label>
          </div>
        </details>

        {preview && (
          <div>
            <p style={{ ...fieldLabel, margin: `0 0 ${space.xxs}px` }}>
              Preview — {preview.totalRows} rows, nothing written yet
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={fieldLabel}>
                  <th align="left" style={{ paddingBottom: space.xxs }}>Row</th>
                  <th align="left">Phone</th>
                  <th align="left">Name</th>
                  <th align="left">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                    <td style={{ padding: "8px 0", color: colors.body }}>{r.row}</td>
                    <td style={{ color: colors.ink }}>{r.phoneRaw}</td>
                    <td style={{ color: colors.body }}>{r.name ?? "—"}</td>
                    <td>
                      <Badge tone={r.status === "ok" ? "ok" : "warn"}>{r.status}</Badge>
                      {r.detail ? <span style={{ color: colors.mutedText, fontSize: 12, marginLeft: 8 }}>{r.detail}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {importResult && (
          <p style={{ color: colors.body, fontSize: 13, marginTop: space.xs }}>
            <Badge tone="ok">{importResult.created} created</Badge>{" "}
            <Badge tone="warn">{importResult.rejected} rejected</Badge>{" "}
            of {importResult.totalRows} · {importResult.conversationsCreated} linked to campaign
          </p>
        )}
      </section>

      <section id="leads-list" style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: space.xs }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Leads {campaignId ? "in this campaign" : "(all recent)"}
          </h2>
          <button onClick={loadLeads} disabled={busy !== null} style={buttonStyle("outline", busy !== null, true)}>
            Refresh
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={fieldLabel}>
              <th align="left" style={{ paddingBottom: space.xxs }}>Phone</th>
              <th align="left">Name</th>
              <th align="left">Opted in</th>
              <th align="left">Action</th>
              <th align="left">Result</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const result = sendResults[lead.id];
              return (
                <tr key={lead.id} style={{ borderTop: `1px solid ${colors.hairline}` }}>
                  <td style={{ padding: "10px 0", color: colors.ink }}>{lead.phoneE164}</td>
                  <td style={{ color: colors.body }}>{lead.name ?? "—"}</td>
                  <td>{lead.optedIn ? <Badge tone="ok">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                  <td>
                    <button onClick={() => handleSend(lead.id)} disabled={busy !== null} style={buttonStyle("hero", busy !== null, true)}>
                      {busy === `send-${lead.id}` ? "Sending…" : "Send"}
                    </button>
                  </td>
                  <td style={{ maxWidth: 340 }}>
                    {result &&
                      (result.outcome === "blocked_before_send" ? (
                        <span style={{ color: colors.semanticInfo }}>Blocked (test mode): {result.message}</span>
                      ) : result.outcome === "error" ? (
                        <span style={{ color: colors.semanticWarning }}>Error: {result.message}</span>
                      ) : (
                        <span style={{ color: colors.body }}>{JSON.stringify(result.result)}</span>
                      ))}
                  </td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: colors.mutedText, padding: space.xs }}>
                  No leads loaded — import a CSV above or click Refresh.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
