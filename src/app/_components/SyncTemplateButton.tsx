"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { colors } from "../_lib/ui-tokens";

/**
 * Same pattern as ToggleFollowUpButton.tsx — a small client island inside
 * the server-rendered Campaigns page. Re-fetches this campaign's template
 * status directly from Meta and corrects templateName/templateStatus in the
 * DB, since nothing else in this app ever reconciles those against reality
 * after campaign creation.
 */
export default function SyncTemplateButton({ id }: { id: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function handleSync(e: React.MouseEvent) {
    e.stopPropagation();
    setSyncing(true);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/sync-template`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to sync template status");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      aria-label="Sync template status from Meta"
      title="Sync template status from Meta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        padding: 0,
        border: `1px solid ${colors.hairline}`,
        borderRadius: 6,
        background: "transparent",
        color: syncing ? colors.mutedText : colors.semanticInfo,
        cursor: syncing ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      <RefreshCw size={13} />
    </button>
  );
}
