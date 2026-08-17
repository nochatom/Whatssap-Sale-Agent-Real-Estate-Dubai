"use client";

import { useRef, useState } from "react";
import { Send, Paperclip, Smile, Image as ImageIcon, Video, FileText, Mic, X } from "lucide-react";

import { colors, space, fieldInput, buttonStyle } from "../_lib/ui-tokens";
import { MEDIA_LIMITS, mediaKindForMimeType, type MediaKind } from "@/whatsapp/types";

// Small, curated, dependency-free set — no emoji-picker library added.
const EMOJI = [
  "😀", "😂", "😊", "😍", "🤔", "😅", "🙏", "👍", "👎", "👏",
  "🎉", "❤️", "🔥", "✅", "❌", "⏰", "📞", "📅", "💬", "🏠",
  "🚗", "💰", "📸", "🎥", "📄", "😢", "😮", "🙌", "👋", "🤝",
];

const ATTACHMENT_ACCEPT: Record<MediaKind, string> = {
  image: MEDIA_LIMITS.image.mimeTypes.join(","),
  video: MEDIA_LIMITS.video.mimeTypes.join(","),
  document: MEDIA_LIMITS.document.mimeTypes.join(","),
  audio: MEDIA_LIMITS.audio.mimeTypes.join(","),
};

const ATTACHMENT_MENU: { kind: MediaKind; label: string; icon: typeof ImageIcon }[] = [
  { kind: "image", label: "Image", icon: ImageIcon },
  { kind: "video", label: "Video", icon: Video },
  { kind: "document", label: "Document", icon: FileText },
  { kind: "audio", label: "Audio", icon: Mic },
];

export interface ReplyPreviewTarget {
  id: string;
  senderLabel: string;
  snippet: string;
}

export interface ComposerSendPayload {
  text?: string;
  file?: File;
  replyToMessageId?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Presentational composer — owns only its own ephemeral input state (text,
 * selected file, which popovers are open). The actual send (network call,
 * optimistic message, retry) lives in InboxClient, which already owns the
 * message list; this just calls onSend() with what the user assembled and
 * clears itself. Reused, unmodified send layer underneath (see
 * /api/conversations/[id]/reply) — this component never calls a provider
 * API directly.
 */
export default function MessageComposer({
  replyingTo,
  onClearReplyTo,
  onSend,
  sending,
}: {
  replyingTo: ReplyPreviewTarget | null;
  onClearReplyTo: () => void;
  onSend: (payload: ComposerSendPayload) => void;
  sending: boolean;
}) {
  const [text, setText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingKindRef = useRef<MediaKind>("image");

  const previewUrl = selectedFile && selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : null;

  function openPicker(kind: MediaKind) {
    pendingKindRef.current = kind;
    setAttachMenuOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.accept = ATTACHMENT_ACCEPT[kind];
      fileInputRef.current.click();
    }
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const kind = mediaKindForMimeType(file.type);
    if (!kind) {
      setFileError(`Unsupported file type: ${file.type || "unknown"}`);
      setSelectedFile(null);
      return;
    }
    const limits = MEDIA_LIMITS[kind];
    if (file.size > limits.maxBytes) {
      setFileError(`Too large — ${kind} files are limited to ${Math.round(limits.maxBytes / (1024 * 1024))}MB`);
      setSelectedFile(null);
      return;
    }
    setFileError(null);
    setSelectedFile(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed && !selectedFile) return;

    onSend({
      text: trimmed || undefined,
      file: selectedFile ?? undefined,
      replyToMessageId: replyingTo?.id,
    });
    setText("");
    setSelectedFile(null);
    setFileError(null);
    onClearReplyTo();
  }

  return (
    <form onSubmit={handleSubmit} style={{ borderTop: `1px solid ${colors.hairline}`, padding: space.xs, display: "flex", flexDirection: "column", gap: 6 }}>
      <input ref={fileInputRef} type="file" onChange={handleFileChosen} style={{ display: "none" }} />

      {replyingTo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.xxs,
            padding: "6px 10px",
            borderLeft: `2px solid ${colors.primary}`,
            background: colors.canvasElevated,
            borderRadius: 6,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: colors.primary }}>Replying to {replyingTo.senderLabel}</p>
            <p style={{ margin: 0, fontSize: 12, color: colors.mutedText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {replyingTo.snippet}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearReplyTo}
            aria-label="Cancel reply"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: colors.mutedText, cursor: "pointer", flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {selectedFile && (
        <div style={{ display: "flex", alignItems: "center", gap: space.xxs, padding: "6px 10px", background: colors.canvasElevated, borderRadius: 6 }}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Selected attachment" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
          ) : (
            <FileText size={18} color={colors.mutedText} style={{ flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedFile.name}</p>
            <p style={{ margin: 0, fontSize: 11, color: colors.mutedText }}>{formatBytes(selectedFile.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedFile(null)}
            aria-label="Remove attachment"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: colors.mutedText, cursor: "pointer", flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {fileError && <p style={{ margin: 0, fontSize: 12, color: colors.semanticWarning }}>{fileError}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => { setAttachMenuOpen((v) => !v); setEmojiOpen(false); }}
            aria-label="Attach a file"
            disabled={sending}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, background: "transparent", border: `1px solid ${colors.hairline}`, borderRadius: 8, color: colors.mutedText, cursor: sending ? "not-allowed" : "pointer", flexShrink: 0 }}
          >
            <Paperclip size={16} />
          </button>
          {attachMenuOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, background: colors.canvasElevated, border: `1px solid ${colors.hairlineStrong}`, borderRadius: 8, padding: 4, display: "flex", flexDirection: "column", gap: 2, zIndex: 10, minWidth: 140 }}>
              {ATTACHMENT_MENU.map(({ kind, label, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => openPicker(kind)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "transparent", border: "none", borderRadius: 6, color: colors.ink, fontSize: 13, cursor: "pointer", textAlign: "left" }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => { setEmojiOpen((v) => !v); setAttachMenuOpen(false); }}
            aria-label="Add emoji"
            disabled={sending}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, background: "transparent", border: `1px solid ${colors.hairline}`, borderRadius: 8, color: colors.mutedText, cursor: sending ? "not-allowed" : "pointer", flexShrink: 0 }}
          >
            <Smile size={16} />
          </button>
          {emojiOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, background: colors.canvasElevated, border: `1px solid ${colors.hairlineStrong}`, borderRadius: 8, padding: 8, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, zIndex: 10, width: 240 }}>
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setText((t) => t + emoji)}
                  style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", padding: 4, borderRadius: 4, lineHeight: 1 }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a reply…"
          disabled={sending}
          style={{ ...fieldInput, flex: 1 }}
        />
        <button
          type="submit"
          disabled={(!text.trim() && !selectedFile) || sending}
          style={{ ...buttonStyle("hero", (!text.trim() && !selectedFile) || sending), display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}
        >
          <Send size={14} />
          {sending ? "Sending…" : "Reply"}
        </button>
      </div>
    </form>
  );
}
