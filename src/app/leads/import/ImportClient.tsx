"use client";

import { useState } from "react";
import Link from "next/link";
import { parse } from "csv-parse/sync";

import Badge from "../../_components/Badge";
import WorkflowStepper from "../../_components/WorkflowStepper";
import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../../_lib/ui-tokens";

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
}

/** Wraps a field in quotes only when needed, doubling any internal quotes — minimal, self-contained CSV escaping for the two columns this ever emits. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildMappedCsv(rows: string[][], phoneIndex: number, nameIndex: number | null): string {
  const lines = ["phone,name"];
  for (const row of rows) {
    const phone = row[phoneIndex] ?? "";
    const name = nameIndex !== null ? (row[nameIndex] ?? "") : "";
    lines.push(`${csvField(phone)},${csvField(name)}`);
  }
  return lines.join("\n");
}

export default function ImportClient({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [phoneColumn, setPhoneColumn] = useState<string>("");
  const [nameColumn, setNameColumn] = useState<string>("");
  const [campaignId, setCampaignId] = useState("");
  const [defaultCountry, setDefaultCountry] = useState("AE");
  const [preview, setPreview] = useState<{ totalRows: number; rows: PreviewRow[] } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    setPreview(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      let rows: string[][];
      try {
        rows = parse(text, { skip_empty_lines: true, trim: true }) as string[][];
      } catch {
        setError("Could not read this file as CSV.");
        return;
      }
      const [detectedHeaders, ...rest] = rows;
      if (!detectedHeaders) {
        setError("The file has no header row.");
        return;
      }
      setHeaders(detectedHeaders);
      setDataRows(rest);

      const guessedPhone = detectedHeaders.find((h) => h.toLowerCase().includes("phone")) ?? detectedHeaders[0] ?? "";
      const guessedName = detectedHeaders.find((h) => h.toLowerCase().includes("name")) ?? "";
      setPhoneColumn(guessedPhone);
      setNameColumn(guessedName);
    };
    reader.readAsText(file);
  }

  function mappedCsv(): string | null {
    if (!phoneColumn) return null;
    const phoneIndex = headers.indexOf(phoneColumn);
    const nameIndex = nameColumn ? headers.indexOf(nameColumn) : -1;
    if (phoneIndex === -1) return null;
    return buildMappedCsv(dataRows, phoneIndex, nameIndex === -1 ? null : nameIndex);
  }

  async function handlePreview() {
    const csvContent = mappedCsv();
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
    const csvContent = mappedCsv();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <WorkflowStepper current="import" />

      <h1 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "0.2px", margin: `0 0 ${space.xxs}px` }}>Import CSV</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.md}px` }}>
        Upload contacts, map columns, validate phone numbers, and import — leads and duplicates are checked before
        anything is written.
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

      <section style={{ ...sectionStyle, marginBottom: space.lg }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>1. Upload</h2>
        <p style={{ color: colors.mutedText, fontSize: 13, margin: `4px 0 ${space.sm}px` }}>Any CSV with a header row.</p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          style={{ color: colors.ink, fontSize: 13, display: "block" }}
        />
        {fileName && <p style={{ color: colors.mutedText, fontSize: 12, margin: `${space.xxs}px 0 0` }}>{fileName} — {dataRows.length} rows</p>}
      </section>

      {headers.length > 0 && (
        <section style={{ ...sectionStyle, marginBottom: space.lg }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>2. Map columns</h2>
          <p style={{ color: colors.mutedText, fontSize: 13, margin: `4px 0 ${space.sm}px` }}>
            Detected columns: {headers.join(", ")}
          </p>

          <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap", marginBottom: space.sm }}>
            <label style={{ ...fieldLabel, display: "block" }}>
              Phone column *
              <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: 220 }}>
                <option value="">— select —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
            <label style={{ ...fieldLabel, display: "block" }}>
              Name column (optional)
              <select value={nameColumn} onChange={(e) => setNameColumn(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: 220 }}>
                <option value="">— none —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
            <label style={{ ...fieldLabel, display: "block" }}>
              Default country
              <input value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: 80 }} />
            </label>
          </div>

          <label style={{ ...fieldLabel, display: "block", marginBottom: space.sm }}>
            Link to campaign (optional)
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: 320 }}>
              <option value="">— don't link —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: space.xs }}>
            <button disabled={!phoneColumn || busy !== null} onClick={handlePreview} style={buttonStyle("outline", !phoneColumn || busy !== null)}>
              {busy === "preview" ? "Previewing…" : "Preview"}
            </button>
            <button disabled={!preview || busy !== null} onClick={handleImport} style={buttonStyle("hero", !preview || busy !== null)}>
              {busy === "import" ? "Importing…" : "Import"}
            </button>
          </div>
        </section>
      )}

      {preview && !importResult && (
        <section style={{ ...sectionStyle, marginBottom: space.lg }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>3. Preview</h2>
          <p style={{ ...fieldLabel, margin: `4px 0 ${space.xs}px` }}>{preview.totalRows} rows — nothing written yet</p>
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
        </section>
      )}

      {importResult && (
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Import results</h2>
          <p style={{ color: colors.body, fontSize: 13, margin: `${space.xs}px 0` }}>
            <Badge tone="ok">{importResult.created} created</Badge>{" "}
            <Badge tone="warn">{importResult.rejected} rejected</Badge>{" "}
            of {importResult.totalRows} · {importResult.conversationsCreated} linked to campaign
          </p>
          <Link href="/leads" style={{ ...buttonStyle("hero", false), display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Continue to Select Leads →
          </Link>
        </section>
      )}
    </main>
  );
}
