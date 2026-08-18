"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, AlertCircle, Paperclip, Reply as ReplyIcon, RotateCcw, Loader2, Download, X, FileText, Copy as CopyIcon, Search, Archive, ArchiveRestore, MailOpen } from "lucide-react";

import Badge from "../_components/Badge";
import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../_lib/ui-tokens";
import { CONVERSATION_STATUS_DISPLAY, type DerivedConversationStatus } from "../_lib/conversation-status";
import MessageComposer, { type ComposerSendPayload, type ReplyPreviewTarget } from "./MessageComposer";

export interface ConversationSummary {
  id: string;
  lead: { phoneE164: string; name: string | null };
  campaign: { name: string } | null;
  status: DerivedConversationStatus;
  lastMessage: string | null;
  lastMessageStatus: MessageStatusValue | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  updatedAt: string;
  isUnread: boolean;
  archivedAt: string | null;
}

type MessageStatusValue = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";

interface MessageItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  type: string;
  templateName: string | null;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  replyToMessageId: string | null;
  status: MessageStatusValue;
  createdAt: string;
  /**
   * Client-only — never comes from the API, never persisted. Present only
   * on an optimistic message the composer just created, before (or instead
   * of) the real fetched row taking its place.
   */
  pending?: {
    clientMessageId: string;
    localPreviewUrl?: string;
    file?: File;
    text?: string;
    replyToMessageId?: string;
    failed: boolean;
    errorMessage?: string;
  };
}

interface ConversationDetail {
  id: string;
  lead: { phoneE164: string; name: string | null };
  campaign: { name: string } | null;
  status: DerivedConversationStatus;
  readAt: string | null;
}

type ReadFilter = "all" | "unread" | "read";
type StatusFilter = "all" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const LIST_POLL_MS = 10_000;
const THREAD_POLL_MS = 5_000;

function leadLabel(lead: { phoneE164: string; name: string | null }): string {
  return lead.name ?? lead.phoneE164;
}

function messageText(m: MessageItem): string | null {
  if (m.body) return m.body;
  if (m.templateName) return `Template: ${m.templateName}`;
  if (m.mediaId) return null; // rendered as an attachment instead
  return `[${m.type}]`;
}

function isImage(m: MessageItem): boolean {
  return !!m.mediaId && (m.mimeType?.startsWith("image/") ?? false);
}

function isVideo(m: MessageItem): boolean {
  return !!m.mediaId && (m.mimeType?.startsWith("video/") ?? false);
}

/** "Today" / "Yesterday" / a full date — never a raw timestamp reused as a label. */
function dateSeparatorLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fileLabel(m: MessageItem): string {
  if (m.filename) return m.filename;
  if (m.mimeType) {
    const [, subtype] = m.mimeType.split("/");
    if (subtype) return subtype.toUpperCase();
  }
  return "File";
}

/** Small WhatsApp-style status indicator for an outbound message — only ever the real MessageStatus, never invented. */
function MessageStatusIndicator({ status }: { status: MessageStatusValue }) {
  if (status === "FAILED") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <AlertCircle size={11} /> Failed
      </span>
    );
  }
  if (status === "READ") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <CheckCheck size={12} /> Read
      </span>
    );
  }
  if (status === "DELIVERED") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <CheckCheck size={12} /> Delivered
      </span>
    );
  }
  if (status === "SENT" || status === "QUEUED") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <Check size={12} /> Sent
      </span>
    );
  }
  return null;
}

/** Copies message text only — never timestamp, sender, or status. Local to this file: CopyButton.tsx's aria-label/title are hardcoded to "Campaign ID", not reusable here. */
function CopyMessageButton({ text, inverted }: { text: string; inverted: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy message text"
      title="Copy message"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: inverted ? colors.onPrimary : colors.mutedText, cursor: "pointer", padding: 0, flexShrink: 0 }}
    >
      {copied ? <Check size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}

/**
 * Inbox — two-pane view over the existing Conversation/Message data (list
 * pane + thread pane), polling the GET-only API routes so it picks up
 * whatever the existing webhook -> handle-inbound -> send-ai-reply pipeline
 * has already persisted. Reply/Delete/Mark-as-read are real writes now (see
 * /api/conversations/[id]/reply, /api/conversations/[id] DELETE + PATCH),
 * all going through existing, unchanged send/compliance logic.
 */
export default function InboxClient({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [replyingTo, setReplyingTo] = useState<MessageItem | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"inbox" | "archived">("inbox");
  const [unreadCount, setUnreadCount] = useState(0);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // List pane: load on view change, then poll for new/updated conversations.
  // Search is client-side only (filters the already-fetched list below) —
  // no new query, no parallel index, same data this pane already has.
  useEffect(() => {
    let cancelled = false;

    async function refreshList() {
      try {
        const res = await fetch(`/api/conversations${view === "archived" ? "?archived=true" : ""}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setConversations(data.conversations ?? []);
          setUnreadCount(data.unreadCount ?? 0);
        }
      } catch {
        // Transient network hiccup — next poll retries, nothing to surface here.
      }
    }
    refreshList();
    const interval = setInterval(refreshList, LIST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view]);

  // Composer state is conversation-specific — a reply target from the
  // previously open conversation must never carry over when switching to
  // another one, regardless of which UI path changed selectedId.
  useEffect(() => {
    setReplyingTo(null);
  }, [selectedId]);

  // Thread pane: load + poll the selected conversation's messages.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function loadThread(showLoading: boolean) {
      if (showLoading) setThreadLoading(true);
      try {
        const res = await fetch(`/api/conversations/${selectedId}/messages`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setDetail(data.conversation);
          // A poll fetches only real, persisted messages — an optimistic
          // (sending/failed) composer message that hasn't landed in the DB
          // yet would otherwise be silently wiped out by a poll landing
          // mid-send or mid-retry. Carry any still-pending local entries
          // forward across the refresh instead of blind-replacing.
          setMessages((prev) => {
            const stillPending = prev.filter((m) => m.pending);
            return [...(data.messages ?? []), ...stillPending];
          });
        }
      } catch {
        // Transient network hiccup — next poll retries.
      } finally {
        if (!cancelled && showLoading) setThreadLoading(false);
      }
    }

    loadThread(true);
    const interval = setInterval(() => loadThread(false), THREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Opening a conversation marks it read — the natural "I looked at this" signal.
  useEffect(() => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv?.isUnread) return;
    fetch(`/api/conversations/${selectedId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    })
      .then(() => setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, isUnread: false } : c))))
      .catch(() => {});
    // Only re-run when the selected conversation changes, not on every poll refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (readFilter === "unread" && !c.isUnread) return false;
      if (readFilter === "read" && c.isUnread) return false;
      if (statusFilter !== "all" && c.lastMessageStatus !== statusFilter) return false;
      if (query) {
        const nameMatch = c.lead.name?.toLowerCase().includes(query) ?? false;
        const phoneMatch = c.lead.phoneE164.toLowerCase().includes(query);
        if (!nameMatch && !phoneMatch) return false;
      }
      return true;
    });
  }, [conversations, readFilter, statusFilter, searchQuery]);

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredChecked =
    filteredConversations.length > 0 && filteredConversations.every((c) => checkedIds.has(c.id));

  function toggleSelectAll() {
    setCheckedIds((prev) => {
      if (allFilteredChecked) {
        // Deselect just the currently-visible ones — a checked row that's
        // since scrolled out of the active filter stays checked, matching
        // how per-row checking already behaves independent of filtering.
        const next = new Set(prev);
        for (const c of filteredConversations) next.delete(c.id);
        return next;
      }
      const next = new Set(prev);
      for (const c of filteredConversations) next.add(c.id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    const label = ids.length === 1 ? "this conversation" : `these ${ids.length} conversations`;
    const confirmMessage =
      `Permanently delete ${label}?\n\n` +
      `This will also permanently delete all of their messages. This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setBulkBusy(true);
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to delete conversation");
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    // Refetch rather than locally reasoning about which of the loop's calls
    // actually succeeded — simpler and always correct. Same view as currently open.
    try {
      const res = await fetch(`/api/conversations${view === "archived" ? "?archived=true" : ""}`);
      const data = await res.json();
      if (res.ok) {
        setConversations(data.conversations ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // next poll will catch up
    }
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    setCheckedIds(new Set());
    setBulkBusy(false);
    if (failures.length > 0) window.alert(failures.join(" · "));
  }

  async function bulkPatch(ids: string[], body: Record<string, boolean>): Promise<string[]> {
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Request failed");
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    return failures;
  }

  async function handleBulkMarkRead() {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const failures = await bulkPatch(ids, { read: true });
    setConversations((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, isUnread: false } : c)));
    setUnreadCount((prev) => Math.max(0, prev - ids.filter((id) => conversations.find((c) => c.id === id)?.isUnread).length));
    setCheckedIds(new Set());
    setBulkBusy(false);
    if (failures.length > 0) window.alert(failures.join(" · "));
  }

  async function handleBulkMarkUnread() {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const failures = await bulkPatch(ids, { read: false });
    setConversations((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, isUnread: !!c.lastInboundAt } : c)));
    setCheckedIds(new Set());
    setBulkBusy(false);
    if (failures.length > 0) window.alert(failures.join(" · "));
  }

  async function handleToggleArchive(conv: ConversationSummary) {
    const archiving = !conv.archivedAt;
    setArchiveBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conv.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: archiving }),
      });
      if (!res.ok) throw new Error("Failed to update conversation");
      // Whichever way it moved, it no longer belongs in the currently open view.
      setConversations((prev) => prev.filter((c) => c.id !== conv.id));
      if (selectedId === conv.id) setSelectedId(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  }

  // Sends one composer submission: appends an optimistic bubble immediately,
  // POSTs the real request, then either reconciles (removes the optimistic
  // entry and pulls the real persisted message in) or marks it failed with
  // a Retry action. clientMessageId is stable across retries of the same
  // logical send, which is what makes Retry idempotency-safe server-side —
  // see buildManualReplyIdempotencyKey.
  async function submitComposerSend(
    clientMessageId: string,
    text: string | undefined,
    file: File | undefined,
    replyToMessageId: string | undefined,
  ) {
    if (!selectedId) return;
    setSendingReply(true);

    try {
      const form = new FormData();
      form.set("clientMessageId", clientMessageId);
      if (text) form.set("body", text);
      if (file) form.set("file", file);
      if (replyToMessageId) form.set("replyToMessageId", replyToMessageId);

      const res = await fetch(`/api/conversations/${selectedId}/reply`, { method: "POST", body: form });
      const data = await res.json();

      const isIdempotencyReplay = data.result?.sent === false && data.result?.blockedBy === "idempotency_conflict";
      const succeeded = res.ok && data.outcome === "returned" && (data.result?.sent === true || isIdempotencyReplay);

      if (succeeded) {
        setMessages((prev) => prev.filter((m) => m.pending?.clientMessageId !== clientMessageId));
        // Pull the real persisted message in immediately instead of waiting for the next poll.
        const res2 = await fetch(`/api/conversations/${selectedId}/messages`);
        const data2 = await res2.json();
        if (res2.ok) {
          setDetail(data2.conversation);
          setMessages(data2.messages ?? []);
        }
        return;
      }

      const errorMessage =
        data.outcome === "blocked_before_send"
          ? data.message
          : data.result?.sent === false
            ? `Blocked by compliance gate: ${data.result.blockedBy}`
            : (data.message ?? data.error ?? "Failed to send");

      setMessages((prev) =>
        prev.map((m) =>
          m.pending?.clientMessageId === clientMessageId
            ? { ...m, pending: { ...m.pending!, failed: true, errorMessage } }
            : m,
        ),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.pending?.clientMessageId === clientMessageId
            ? { ...m, pending: { ...m.pending!, failed: true, errorMessage: err instanceof Error ? err.message : String(err) } }
            : m,
        ),
      );
    } finally {
      setSendingReply(false);
    }
  }

  function handleComposerSend(payload: ComposerSendPayload) {
    const clientMessageId = crypto.randomUUID();
    const localPreviewUrl = payload.file && payload.file.type.startsWith("image/") ? URL.createObjectURL(payload.file) : undefined;

    const optimistic: MessageItem = {
      id: `pending:${clientMessageId}`,
      direction: "OUTBOUND",
      body: payload.text ?? null,
      type: payload.file ? (payload.file.type.split("/")[0] ?? "document") : "text",
      templateName: null,
      filename: payload.file?.name ?? null,
      mediaId: null,
      mimeType: payload.file?.type ?? null,
      replyToMessageId: payload.replyToMessageId ?? null,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
      pending: {
        clientMessageId,
        localPreviewUrl,
        file: payload.file,
        text: payload.text,
        replyToMessageId: payload.replyToMessageId,
        failed: false,
      },
    };
    setMessages((prev) => [...prev, optimistic]);
    submitComposerSend(clientMessageId, payload.text, payload.file, payload.replyToMessageId);
  }

  function handleRetry(m: MessageItem) {
    if (!m.pending) return;
    setMessages((prev) =>
      prev.map((item) => (item.id === m.id ? { ...item, pending: { ...item.pending!, failed: false, errorMessage: undefined } } : item)),
    );
    submitComposerSend(m.pending.clientMessageId, m.pending.text, m.pending.file, m.pending.replyToMessageId);
  }

  return (
    <div>
      {/* View toggle + unread badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.xs, marginBottom: space.xs, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => { setView("inbox"); setSelectedId(null); setCheckedIds(new Set()); }}
            style={{ ...buttonStyle(view === "inbox" ? "solid" : "outline", false, true) }}
          >
            Inbox{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>
          <button
            onClick={() => { setView("archived"); setSelectedId(null); setCheckedIds(new Set()); }}
            style={{ ...buttonStyle(view === "archived" ? "solid" : "outline", false, true) }}
          >
            Archived
          </button>
        </div>
        <label style={{ position: "relative", display: "block" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.mutedText, pointerEvents: "none" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name or phone…"
            style={{ ...fieldInput, paddingLeft: 32, width: 220 }}
            aria-label="Search conversations by name or phone"
          />
        </label>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs, alignItems: "flex-end", marginBottom: space.xs }}>
        <label style={{ ...fieldLabel, display: "block" }}>
          Read status
          <select
            value={readFilter}
            onChange={(e) => setReadFilter(e.target.value as ReadFilter)}
            style={{ ...fieldInput, display: "block", marginTop: 4, width: 150 }}
          >
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
        </label>
        <label style={{ ...fieldLabel, display: "block" }}>
          Last message status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ ...fieldInput, display: "block", marginTop: 4, width: 170 }}
          >
            <option value="all">All</option>
            <option value="SENT">Sent</option>
            <option value="DELIVERED">Delivered</option>
            <option value="READ">Read</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
      </div>

      {/* Bulk action bar — only when something's checked */}
      {checkedIds.size > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.xs,
            padding: `${space.xxs}px ${space.xs}px`,
            marginBottom: space.xs,
            borderRadius: 8,
            background: colors.canvasElevated,
            border: `1px solid ${colors.hairline}`,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.ink }}>{checkedIds.size} selected</p>
          <div style={{ display: "flex", gap: space.xxs }}>
            <button onClick={handleBulkMarkRead} disabled={bulkBusy} style={buttonStyle("outline", bulkBusy, true)}>
              Mark as Read
            </button>
            <button onClick={handleBulkMarkUnread} disabled={bulkBusy} style={buttonStyle("outline", bulkBusy, true)}>
              Mark as Unread
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkBusy}
              style={{ ...buttonStyle("outline", bulkBusy, true), color: colors.semanticWarning, borderColor: colors.semanticWarning }}
            >
              {bulkBusy ? "Working…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: space.sm, alignItems: "flex-start" }}>
        {/* List pane */}
        <section style={{ ...sectionStyle, width: 340, flexShrink: 0, padding: 0, overflow: "hidden" }}>
          {filteredConversations.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: `${space.xxs}px ${space.xs}px`,
                borderBottom: `1px solid ${colors.hairline}`,
                background: colors.canvasElevated,
              }}
            >
              <input
                type="checkbox"
                checked={allFilteredChecked}
                onChange={toggleSelectAll}
                style={{ flexShrink: 0 }}
                aria-label={allFilteredChecked ? "Deselect all conversations" : "Select all conversations"}
              />
              <label
                style={{ fontSize: 13, fontWeight: 600, color: colors.ink, cursor: "pointer" }}
                onClick={toggleSelectAll}
              >
                Select all ({filteredConversations.length})
              </label>
            </div>
          )}
          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            {filteredConversations.length === 0 && (
              <p style={{ color: colors.mutedText, fontSize: 13, padding: space.md, margin: 0 }}>
                {conversations.length === 0 ? "No conversations yet." : "No conversations match these filters."}
              </p>
            )}
            {filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedId;
              const isChecked = checkedIds.has(conv.id);
              const statusDisplay = CONVERSATION_STATUS_DISPLAY[conv.status];
              return (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(conv.id);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    width: "100%",
                    textAlign: "left",
                    background: isSelected ? colors.canvas : "transparent",
                    border: "none",
                    borderLeft: `2px solid ${isSelected ? colors.primary : "transparent"}`,
                    borderBottom: `1px solid ${colors.hairline}`,
                    padding: `${space.xxs}px ${space.xs}px`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleChecked(conv.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 3, flexShrink: 0 }}
                    aria-label={`Select conversation with ${leadLabel(conv.lead)}`}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: space.xxs }}>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: conv.isUnread ? 700 : 600,
                          color: colors.ink,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {conv.isUnread && (
                          <span style={{ width: 7, height: 7, borderRadius: 9999, background: colors.primary, flexShrink: 0 }} />
                        )}
                        {leadLabel(conv.lead)}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: colors.mutedText }}>
                          {new Date(conv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleToggleArchive(conv); }}
                          disabled={archiveBusy}
                          aria-label={conv.archivedAt ? `Restore conversation with ${leadLabel(conv.lead)}` : `Archive conversation with ${leadLabel(conv.lead)}`}
                          title={conv.archivedAt ? "Restore" : "Archive"}
                          style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: colors.mutedText, cursor: archiveBusy ? "not-allowed" : "pointer", padding: 0 }}
                        >
                          {conv.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                        </button>
                      </span>
                    </div>
                    <p
                      style={{
                        margin: "4px 0 6px",
                        fontSize: 13,
                        color: colors.mutedText,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {conv.lastMessage ?? "No messages yet"}
                    </p>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>
                      {!conv.campaign && <Badge tone="neutral">Organic</Badge>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Thread pane */}
        <section style={{ ...sectionStyle, flex: "1 1 480px", minHeight: 640, display: "flex", flexDirection: "column", padding: 0 }}>
          {!selectedId || !detail ? (
            <p style={{ color: colors.mutedText, fontSize: 13, margin: "auto", padding: space.md }}>
              {threadLoading ? "Loading…" : "Select a conversation to read its messages."}
            </p>
          ) : (
            <>
              <div style={{ padding: space.xs, borderBottom: `1px solid ${colors.hairline}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.xs, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.ink }}>{leadLabel(detail.lead)}</p>
                  <p style={{ margin: 0, fontSize: 12, color: colors.mutedText }}>{detail.lead.phoneE164}</p>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {detail.campaign ? <Badge tone="neutral">{detail.campaign.name}</Badge> : <Badge tone="neutral">Organic</Badge>}
                  <Badge tone={CONVERSATION_STATUS_DISPLAY[detail.status].tone}>{CONVERSATION_STATUS_DISPLAY[detail.status].label}</Badge>
                  <button
                    type="button"
                    onClick={async () => {
                      const failures = await bulkPatch([selectedId as string], { read: false });
                      if (failures.length > 0) { window.alert(failures[0]); return; }
                      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, isUnread: !!c.lastInboundAt } : c)));
                    }}
                    aria-label="Mark as unread"
                    title="Mark as unread"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, background: "transparent", border: `1px solid ${colors.hairline}`, borderRadius: 6, color: colors.mutedText, cursor: "pointer" }}
                  >
                    <MailOpen size={13} />
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: space.xs, display: "flex", flexDirection: "column", gap: space.xxs, maxHeight: 480 }}>
                {messages.length === 0 && (
                  <p style={{ color: colors.mutedText, fontSize: 13, margin: "auto" }}>No messages in this conversation yet.</p>
                )}
                {messages.map((m, index) => {
                  const isInbound = m.direction === "INBOUND";
                  const text = messageText(m);
                  const quoted = m.replyToMessageId ? messages.find((other) => other.id === m.replyToMessageId) : null;
                  const isPending = !!m.pending;
                  const isFailed = !!m.pending?.failed;
                  const isVid = isVideo(m);
                  const imageUrl = m.pending?.localPreviewUrl ?? (m.mediaId && isImage(m) ? `/api/whatsapp/media/${m.mediaId}` : null);
                  const videoUrl = m.mediaId && isVid ? `/api/whatsapp/media/${m.mediaId}` : null;
                  const isFile = !!m.mediaId && !isImage(m) && !isVid;
                  const fileUrl = isFile ? `/api/whatsapp/media/${m.mediaId}` : null;

                  const prev = messages[index - 1];
                  const showDateSeparator = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();

                  return (
                    <div key={m.id}>
                      {showDateSeparator && (
                        <div style={{ display: "flex", justifyContent: "center", margin: `${space.xs}px 0` }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: colors.mutedText, background: colors.canvasElevated, border: `1px solid ${colors.hairline}`, borderRadius: 9999, padding: "3px 12px" }}>
                            {dateSeparatorLabel(m.createdAt)}
                          </span>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: isInbound ? "flex-start" : "flex-end", gap: 4 }}>
                        {!isInbound && !isPending && (
                          <button
                            type="button"
                            onClick={() => setReplyingTo(m)}
                            aria-label="Reply to this message"
                            title="Reply"
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "center", width: 22, height: 22, background: "transparent", border: "none", color: colors.mutedText, cursor: "pointer", flexShrink: 0 }}
                          >
                            <ReplyIcon size={13} />
                          </button>
                        )}
                        {/* Reply is offered on both inbound and outbound messages —
                            quoting the customer's own message is the more common
                            case in a real inbox. Excluded only while still pending
                            (no stable persisted id to quote yet). */}
                        <div
                          style={{
                            maxWidth: "70%",
                            background: isInbound ? colors.canvas : colors.primary,
                            color: isInbound ? colors.ink : colors.onPrimary,
                            border: isInbound ? `1px solid ${colors.hairline}` : isFailed ? `1px solid ${colors.semanticWarning}` : "none",
                            borderRadius: 10,
                            padding: "8px 12px",
                            opacity: isPending && !isFailed ? 0.7 : 1,
                          }}
                        >
                          {quoted && (
                            <div
                              style={{
                                borderLeft: `2px solid ${isInbound ? colors.primary : colors.onPrimary}`,
                                paddingLeft: 8,
                                marginBottom: 6,
                                opacity: 0.8,
                              }}
                            >
                              <p style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>
                                {quoted.direction === "INBOUND" ? leadLabel(detail.lead) : "You"}
                              </p>
                              <p style={{ margin: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {messageText(quoted) ?? `[${quoted.type}]`}
                              </p>
                            </div>
                          )}
                          {imageUrl && (
                            <div style={{ position: "relative", marginBottom: text ? 6 : 0 }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={imageUrl}
                                alt="Attachment"
                                onClick={() => !isPending && setExpandedImageUrl(imageUrl)}
                                style={{ maxWidth: "100%", borderRadius: 6, display: "block", cursor: isPending ? "default" : "zoom-in" }}
                              />
                            </div>
                          )}
                          {videoUrl && (
                            // eslint-disable-next-line jsx-a11y/media-has-caption
                            <video
                              controls
                              src={videoUrl}
                              style={{ maxWidth: "100%", borderRadius: 6, display: "block", marginBottom: text ? 6 : 0 }}
                            />
                          )}
                          {fileUrl && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: text ? 6 : 0 }}>
                              <FileText size={20} style={{ flexShrink: 0 }} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileLabel(m)}</p>
                                {m.mimeType && <p style={{ margin: 0, fontSize: 11, opacity: 0.8 }}>{m.mimeType}</p>}
                              </div>
                              <a
                                href={fileUrl}
                                download={m.filename ?? undefined}
                                aria-label={`Download ${fileLabel(m)}`}
                                title="Download"
                                style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "inherit", flexShrink: 0 }}
                              >
                                <Download size={16} />
                              </a>
                            </div>
                          )}
                          {isPending && !imageUrl && !videoUrl && !fileUrl && m.pending?.file && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: text ? 6 : 0 }}>
                              <Paperclip size={13} />
                              {m.pending.file.name}
                            </div>
                          )}
                          {text && (
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>{text}</p>
                              {!isPending && (
                                <span style={{ flexShrink: 0, opacity: 0.7, marginTop: 2 }}>
                                  <CopyMessageButton text={text} inverted={!isInbound} />
                                </span>
                              )}
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 6,
                              marginTop: 4,
                              fontSize: 11,
                              color: isInbound ? colors.mutedText : colors.onPrimary,
                            }}
                          >
                            {isPending ? (
                              isFailed ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <AlertCircle size={11} />
                                  {m.pending?.errorMessage ?? "Failed to send"}
                                  <button
                                    type="button"
                                    onClick={() => handleRetry(m)}
                                    style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "transparent", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0 }}
                                  >
                                    <RotateCcw size={11} />
                                    Retry
                                  </button>
                                </span>
                              ) : (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  <Loader2 size={11} />
                                  Sending…
                                </span>
                              )
                            ) : (
                              <>
                                <span>{timeOnly(m.createdAt)}</span>
                                {!isInbound && <MessageStatusIndicator status={m.status} />}
                              </>
                            )}
                          </div>
                        </div>
                        {isInbound && !isPending && (
                          <button
                            type="button"
                            onClick={() => setReplyingTo(m)}
                            aria-label="Reply to this message"
                            title="Reply"
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "center", width: 22, height: 22, background: "transparent", border: "none", color: colors.mutedText, cursor: "pointer", flexShrink: 0 }}
                          >
                            <ReplyIcon size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              <MessageComposer
                key={selectedId}
                replyingTo={
                  replyingTo
                    ? {
                        id: replyingTo.id,
                        senderLabel: replyingTo.direction === "INBOUND" ? leadLabel(detail.lead) : "You",
                        snippet: messageText(replyingTo) ?? `[${replyingTo.type}]`,
                      }
                    : null
                }
                onClearReplyTo={() => setReplyingTo(null)}
                onSend={handleComposerSend}
                sending={sendingReply}
              />
            </>
          )}
        </section>
      </div>

      {expandedImageUrl && (
        <div
          onClick={() => setExpandedImageUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: space.md,
            cursor: "zoom-out",
          }}
        >
          <button
            type="button"
            onClick={() => setExpandedImageUrl(null)}
            aria-label="Close"
            style={{ position: "absolute", top: space.sm, right: space.sm, display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, background: colors.canvasElevated, border: `1px solid ${colors.hairlineStrong}`, color: colors.ink, cursor: "pointer" }}
          >
            <X size={18} />
          </button>
          <a
            href={expandedImageUrl}
            download
            onClick={(e) => e.stopPropagation()}
            aria-label="Download image"
            title="Download"
            style={{ position: "absolute", top: space.sm, right: `calc(${space.sm}px + 44px)`, display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, background: colors.canvasElevated, border: `1px solid ${colors.hairlineStrong}`, color: colors.ink }}
          >
            <Download size={16} />
          </a>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expandedImageUrl}
            alt="Expanded attachment"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8, cursor: "default" }}
          />
        </div>
      )}
    </div>
  );
}
