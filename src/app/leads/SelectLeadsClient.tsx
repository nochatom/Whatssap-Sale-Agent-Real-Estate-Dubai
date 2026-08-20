"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Badge from "../_components/Badge";
import WorkflowStepper from "../_components/WorkflowStepper";
import { runBulkAction } from "../_lib/bulk-action";
import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../_lib/ui-tokens";

interface Lead {
  id: string;
  phoneE164: string;
  name: string | null;
  optedIn: boolean;
  createdAt: string;
}

type OptedInFilter = "all" | "opted-in" | "not-opted-in";

/**
 * Dedicated to display/search/filter/select — no CSV import, no sending.
 * Selection is passed to /leads/send via a URL query param so the flow
 * survives refresh/back-button, and the Send page can be reached directly
 * without JS state (no client-side store needed).
 */
export default function SelectLeadsClient() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [optedInFilter, setOptedInFilter] = useState<OptedInFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function loadLeads() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/leads");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load leads");
      setLeads(data.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLeads();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (optedInFilter === "opted-in" && !lead.optedIn) return false;
      if (optedInFilter === "not-opted-in" && lead.optedIn) return false;
      if (!q) return true;
      return lead.phoneE164.toLowerCase().includes(q) || (lead.name ?? "").toLowerCase().includes(q);
    });
  }, [leads, query, optedInFilter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const l of filtered) next.delete(l.id);
      } else {
        for (const l of filtered) next.add(l.id);
      }
      return next;
    });
  }

  function goToSend() {
    const ids = Array.from(selected);
    router.push(`/leads/send?leadIds=${ids.map(encodeURIComponent).join(",")}`);
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const label = ids.length === 1 ? (leads.find((l) => l.id === ids[0])?.phoneE164 ?? "this lead") : `these ${ids.length} leads`;
    const confirmMessage =
      `Permanently delete ${label}?\n\n` +
      `This will also permanently delete their conversation history — messages, follow-ups, and AI decisions.\n\n` +
      `This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setDeleting(true);
    setError(null);
    const failures = await runBulkAction(ids, async (id) => {
      try {
        const res = await fetch(`/api/leads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to delete lead");
        setLeads((prev) => prev.filter((l) => l.id !== id));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (err) {
        const lead = leads.find((l) => l.id === id);
        throw new Error(`${lead?.phoneE164 ?? id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    if (failures.length > 0) setError(failures.join(" · "));
    setDeleting(false);
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: `${space.lg}px ${space.md}px` }}>
      <WorkflowStepper current="select" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space.sm, marginBottom: space.xxs }}>
        <h1 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "0.2px", margin: 0 }}>Select Leads</h1>
        <Link href="/leads/new" style={{ ...buttonStyle("outline", false), display: "inline-flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}>
          New Contact
        </Link>
      </div>
      <p style={{ color: colors.mutedText, fontSize: 13, margin: `0 0 ${space.md}px` }}>
        Search, filter, and choose which leads the next step will send to.
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

      <section style={sectionStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs, alignItems: "flex-end" }}>
          <label style={{ ...fieldLabel, display: "block" }}>
            Search
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or phone"
              style={{ ...fieldInput, display: "block", marginTop: 4, width: 220 }}
            />
          </label>
          <label style={{ ...fieldLabel, display: "block" }}>
            Opted in
            <select
              value={optedInFilter}
              onChange={(e) => setOptedInFilter(e.target.value as OptedInFilter)}
              style={{ ...fieldInput, display: "block", marginTop: 4, width: 140 }}
            >
              <option value="all">All</option>
              <option value="opted-in">Opted in</option>
              <option value="not-opted-in">Not opted in</option>
            </select>
          </label>
          <button onClick={loadLeads} disabled={loading} style={buttonStyle("outline", loading, true)}>
            Refresh
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.xs,
            marginTop: space.sm,
            paddingTop: space.xs,
            borderTop: `1px solid ${colors.hairline}`,
            marginBottom: space.sm,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink }}>{selected.size} selected</p>
          <div style={{ display: "flex", gap: space.xxs }}>
            <button
              onClick={handleDeleteSelected}
              disabled={selected.size === 0 || deleting}
              style={{
                ...buttonStyle("outline", selected.size === 0 || deleting, true),
                color: colors.semanticWarning,
                // Full border shorthand, not borderColor — buttonStyle's own
                // "outline" variant already sets border as a shorthand
                // string, and mixing shorthand + non-shorthand for the same
                // property triggers a React dev warning ("Updating a style
                // property during rerender... don't mix shorthand and
                // non-shorthand") every time `disabled` toggles.
                border: `1px solid ${selected.size === 0 || deleting ? colors.hairline : colors.semanticWarning}`,
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={goToSend}
              disabled={selected.size === 0}
              style={buttonStyle("hero", selected.size === 0)}
            >
              Continue to Send Campaign →
            </button>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={fieldLabel}>
              <th align="left" style={{ paddingBottom: space.xxs, width: 32 }}>
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} disabled={filtered.length === 0} />
              </th>
              <th align="left">Phone</th>
              <th align="left">Name</th>
              <th align="left">Opted in</th>
              <th align="left">Added</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => {
              const isSelected = selected.has(lead.id);
              return (
                <tr
                  key={lead.id}
                  onClick={() => toggle(lead.id)}
                  style={{
                    borderTop: `1px solid ${colors.hairline}`,
                    borderLeft: `2px solid ${isSelected ? colors.primary : "transparent"}`,
                    background: isSelected ? colors.canvasElevated : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ padding: "10px 0 10px 8px" }}>
                    <input type="checkbox" checked={isSelected} readOnly style={{ pointerEvents: "none" }} />
                  </td>
                  <td style={{ color: colors.ink }}>{lead.phoneE164}</td>
                  <td style={{ color: colors.body }}>{lead.name ?? "—"}</td>
                  <td>{lead.optedIn ? <Badge tone="ok">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                  <td style={{ color: colors.mutedText, fontSize: 12 }}>{new Date(lead.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: colors.mutedText, padding: space.xs }}>
                  {leads.length === 0 ? (
                    <>No leads yet — import some on the Import CSV step.</>
                  ) : (
                    <>No leads match this search/filter.</>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
