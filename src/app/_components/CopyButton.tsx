"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

import { colors } from "../_lib/ui-tokens";

/**
 * Small client island (same pattern as ThemeToggle inside the otherwise
 * server-rendered Sidebar) — the Campaigns page itself stays a server
 * component. Real clipboard write, not a fake success message.
 */
export default function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (non-secure context, permission,
      // lost focus) — fail quietly rather than an unhandled rejection;
      // `copied` simply never flips, so the button just shows no feedback.
    }
  }

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy campaign ID"
      title="Copy campaign ID"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        background: "transparent",
        border: "none",
        color: copied ? colors.semanticSuccess : colors.mutedText,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
