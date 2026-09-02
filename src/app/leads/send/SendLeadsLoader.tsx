"use client";

import { useEffect, useState } from "react";

import SendCampaignClient from "./SendCampaignClient";
import { colors, space, sectionStyle } from "../../_lib/ui-tokens";
import WorkflowStepper from "../../_components/WorkflowStepper";

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

const STORAGE_KEY = "selectedLeadIds";

/**
 * Reads the lead selection from sessionStorage (written by
 * SelectLeadsClient.tsx's goToSend()) instead of a `?leadIds=...` URL query
 * param. The old query-param handoff broke for large selections: Lead ids
 * are 25-char cuids, so a selection in the hundreds/thousands produced a URL
 * tens of thousands of characters long, well past typical browser/edge
 * header-size limits -- the exact failure mode raised in the forensic
 * investigation of the 50->2000 Select Leads limit change. sessionStorage
 * has no comparable ceiling and, like the URL param before it, survives a
 * refresh or back-navigation within the same tab.
 */
export default function SendLeadsLoader({ campaigns }: { campaigns: Campaign[] }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];

    if (ids.length === 0) {
      setLeads([]);
      return;
    }

    fetch("/api/leads/by-ids", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadIds: ids }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load selected leads");
        setLeads(data.leads ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
        <WorkflowStepper current="send" />
        <section style={sectionStyle}>
          <p style={{ color: colors.semanticWarning, fontSize: 14, margin: 0 }}>{error}</p>
        </section>
      </main>
    );
  }

  if (leads === null) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
        <WorkflowStepper current="send" />
        <section style={sectionStyle}>
          <p style={{ color: colors.mutedText, fontSize: 14, margin: 0 }}>Loading selected leads…</p>
        </section>
      </main>
    );
  }

  return <SendCampaignClient campaigns={campaigns} leads={leads} />;
}
