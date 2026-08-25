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
        // The base outline style's plain `ink` text reads as unstyled black
        // text with no button affordance, and doesn't reserve enough width
        // for this label — every other button here is icon-only or a single
        // short word. whiteSpace/flexShrink keep the full two-word label on
        // one line at its natural width instead of wrapping or getting
        // compressed by the flex row it sits in; the accent color (same
        // value as colors.primary, via the semantic "info" token so this
        // doesn't read as a second hero CTA) gives it real visibility
        // without inventing a new color.
        whiteSpace: "nowrap",
        flexShrink: 0,
        color: saving ? colors.mutedText : colors.semanticInfo,
        borderColor: saving ? undefined : colors.semanticInfo,
      }}
    >
      {enabled ? "Disable Follow-up" : "Enable Follow-up"}
    </button>
  );
}
