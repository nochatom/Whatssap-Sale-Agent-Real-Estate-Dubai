"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { colors } from "../_lib/ui-tokens";

/**
 * Same pattern as CopyButton.tsx — a small client island inside the
 * otherwise server-rendered Campaigns page. router.refresh() re-runs the
 * page's server-side Prisma query so the table reflects the deletion
 * immediately, without a full reload.
 */
export default function DeleteCampaignButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete campaign "${name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete campaign");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      aria-label={`Delete campaign ${name}`}
      title="Delete campaign"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        background: "transparent",
        border: "none",
        color: deleting ? colors.mutedText : colors.semanticWarning,
        cursor: deleting ? "not-allowed" : "pointer",
        flexShrink: 0,
      }}
    >
      <Trash2 size={14} />
    </button>
  );
}
