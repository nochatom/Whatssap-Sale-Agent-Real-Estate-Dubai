"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { colors, buttonStyle } from "../_lib/ui-tokens";

/**
 * Same pattern as DeleteCampaignButton.tsx — a small client island inside
 * the otherwise server-rendered Campaigns page. router.refresh() re-runs
 * the page's server-side Prisma query so the badge/button reflects the new
 * state immediately, without a full reload.
 */
export default function ToggleFollowUpButton({
  id,
  enabled,
}: {
  id: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignFollowUpEnabled: !enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update follow-up setting");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={saving}
      aria-label={enabled ? `Disable follow-up` : `Enable follow-up`}
      title={enabled ? "Disable follow-up" : "Enable follow-up"}
      style={{
        ...buttonStyle("outline", saving, true),
        color: saving ? colors.mutedText : undefined,
      }}
    >
      {enabled ? "Disable Follow-up" : "Enable Follow-up"}
    </button>
  );
}
