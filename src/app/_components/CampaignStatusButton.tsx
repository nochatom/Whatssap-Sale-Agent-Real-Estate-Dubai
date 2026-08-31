"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { colors, buttonStyle } from "../_lib/ui-tokens";

type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

/**
 * The only control anywhere in the app for changing a campaign's status
 * after creation — the create form's dropdown was previously the sole
 * place it could ever be set, which silently left every campaign stuck
 * wherever it started (usually DRAFT) with no way to activate it, and no
 * way to see why sends were being blocked by checkCampaignActive.
 *
 * A simple two-state toggle: DRAFT/PAUSED -> ACTIVE, ACTIVE -> PAUSED.
 * ARCHIVED is a terminal state with no UI path anywhere else in the app
 * either, so it's intentionally out of scope here — this button never
 * produces or clears it.
 *
 * campaignFollowUpEnabled is passed through unchanged because the PATCH
 * route still requires it on every call (see ToggleFollowUpButton, the
 * same constraint applies here) — this button only ever changes status.
 */
export default function CampaignStatusButton({
  id,
  status,
  campaignFollowUpEnabled,
}: {
  id: string;
  status: CampaignStatus;
  campaignFollowUpEnabled: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  if (status === "ARCHIVED") return null;

  const nextStatus: CampaignStatus = status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  const label = status === "ACTIVE" ? "Pause" : "Activate";

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignFollowUpEnabled, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update campaign status");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={saving}
      aria-label={`${label} campaign`}
      title={status === "ACTIVE" ? "Pause sending for this campaign" : "Activate this campaign so sends are no longer blocked"}
      style={{
        ...buttonStyle("outline", saving, true),
        whiteSpace: "nowrap",
        flexShrink: 0,
        color: saving ? colors.mutedText : status === "ACTIVE" ? colors.semanticWarning : colors.semanticInfo,
        borderColor: saving ? undefined : status === "ACTIVE" ? colors.semanticWarning : colors.semanticInfo,
      }}
    >
      {saving ? "Working…" : label}
    </button>
  );
}
