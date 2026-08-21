"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { colors, buttonStyle } from "../_lib/ui-tokens";

/**
 * Small client island (same pattern as CopyButton/ThemeToggle) — the
 * Dashboard page itself stays a server component. Deletion only ever
 * happens after the user explicitly confirms here; the API route it calls
 * (POST /api/dashboard/clear-data) does nothing on its own until this fires
 * a request at it. router.refresh() re-runs the Dashboard's server-side
 * data fetch afterward so the now-zeroed counters show immediately,
 * without a full page reload.
 */
export default function ClearDashboardDataButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const confirmed = window.confirm(
      "Permanently clear all Dashboard data?\n\n" +
        "This deletes every Lead, Conversation, Message, Follow-up, and AI decision — " +
        "everything the Dashboard counters are based on.\n\n" +
        "Campaigns and their configuration are not affected.\n\n" +
        "This cannot be undone.",
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/clear-data", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to clear Dashboard data");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      style={{
        ...buttonStyle("outline", busy, true),
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: colors.semanticWarning,
        border: `1px solid ${busy ? colors.hairline : colors.semanticWarning}`,
      }}
    >
      <Trash2 size={13} />
      {busy ? "Clearing…" : "Clear Data"}
    </button>
  );
}
