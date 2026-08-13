"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../../_lib/ui-tokens";

/**
 * Fields map to the real Lead model: phoneE164 (normalized from phone +
 * defaultCountry, same normalizePhoneToE164 CSV import uses), name,
 * market, language, optedIn. No email field — the schema has none, so
 * none is shown rather than inventing one. "Country" here is the Lead
 * model's real `market` column, the closest existing field to it.
 */
export default function NewLeadClient({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [defaultCountry, setDefaultCountry] = useState("AE");
  const [name, setName] = useState("");
  const [market, setMarket] = useState("");
  const [language, setLanguage] = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = phone.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          defaultCountry,
          name: name.trim() || undefined,
          market: market.trim() || undefined,
          language: language.trim() || undefined,
          optedIn,
          campaignId: campaignId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create lead");
      router.push("/leads");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <Link href="/leads" style={{ color: colors.mutedText, fontSize: 13, textDecoration: "none" }}>
        ← Select Leads
      </Link>
      <h1 style={{ fontSize: 26, fontWeight: 500, margin: `${space.xs}px 0 ${space.xxs}px` }}>New Contact</h1>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.md}px` }}>
        Fields match the existing Lead model. No email field — the database doesn't store one.
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
            Phone *
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%", fontSize: 16 }}
              placeholder="e.g. 050 123 4567"
              autoFocus
            />
          </label>

          <label style={{ ...fieldLabel, display: "block", marginBottom: space.xs }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} />
          </label>

          <label style={{ ...fieldLabel, display: "flex", alignItems: "center", gap: 8, marginBottom: space.xs }}>
            <input type="checkbox" checked={optedIn} onChange={(e) => setOptedIn(e.target.checked)} />
            Opted in
          </label>

          <label style={{ ...fieldLabel, display: "block", marginBottom: space.sm }}>
            Link to campaign (optional)
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }}>
              <option value="">— don't link —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <details>
            <summary style={{ ...fieldLabel, cursor: "pointer", listStyle: "none" }}>Details</summary>
            <div style={{ display: "flex", gap: space.sm, marginTop: space.xxs }}>
              <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
                Country
                <input value={market} onChange={(e) => setMarket(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} placeholder="e.g. UAE" />
              </label>
              <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
                Language
                <input value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }} placeholder="e.g. en" />
              </label>
              <label style={{ ...fieldLabel, display: "block", flex: 1 }}>
                Parse phone as
                <select value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value)} style={{ ...fieldInput, display: "block", marginTop: 4, width: "100%" }}>
                  <option value="AE">UAE (AE)</option>
                  <option value="SA">Saudi Arabia (SA)</option>
                  <option value="EG">Egypt (EG)</option>
                  <option value="DZ">Algeria (DZ)</option>
                </select>
              </label>
            </div>
          </details>
        </section>

        <button type="submit" disabled={!canSubmit || busy} style={buttonStyle("hero", !canSubmit || busy)}>
          {busy ? "Creating…" : "Create Contact"}
        </button>
      </form>
    </main>
  );
}
