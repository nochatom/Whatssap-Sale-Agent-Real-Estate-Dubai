"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, AlertCircle, Paperclip, Send } from "lucide-react";

import Badge from "../_components/Badge";
import { colors, space, sectionStyle, fieldLabel, fieldInput, buttonStyle } from "../_lib/ui-tokens";
import { CONVERSATION_STATUS_DISPLAY, type DerivedConversationStatus } from "../_lib/conversation-status";

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
  status: MessageStatusValue;
  createdAt: string;
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

  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // List pane: poll for new/updated conversations.
  useEffect(() => {
    async function refreshList() {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        if (res.ok) setConversations(data.conversations ?? []);
      } catch {
        // Transient network hiccup — next poll retries, nothing to surface here.
      }
    }
    const interval = setInterval(refreshList, LIST_POLL_MS);
    return () => clearInterval(interval);
  }, []);

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
          setMessages(data.messages ?? []);
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
    return conversations.filter((c) => {
      if (readFilter === "unread" && !c.isUnread) return false;
      if (readFilter === "read" && c.isUnread) return false;
      if (statusFilter !== "all" && c.lastMessageStatus !== statusFilter) return false;
      return true;
    });
  }, [conversations, readFilter, statusFilter]);

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
    // actually succeeded — simpler and always correct.
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      if (res.ok) setConversations(data.conversations ?? []);
    } catch {
      // next poll will catch up
    }
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    setCheckedIds(new Set());
    setBulkBusy(false);
    if (failures.length > 0) window.alert(failures.join(" · "));
  }

  async function handleBulkMarkRead() {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ read: true }),
        });
        if (!res.ok) throw new Error("Failed to mark as read");
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    setConversations((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, isUnread: false } : c)));
    setCheckedIds(new Set());
    setBulkBusy(false);
    if (failures.length > 0) window.alert(failures.join(" · "));
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !replyText.trim() || replySending) return;
    setReplySending(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: replyText.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.outcome === "error") {
        throw new Error(data.message ?? data.error ?? "Failed to send reply");
      }
      if (data.outcome === "blocked_before_send") {
        throw new Error(data.message);
      }
      if (data.result?.sent === false) {
        throw new Error(`Blocked by compliance gate: ${data.result.blockedBy}`);
      }
      setReplyText("");
      // Pull the new message in immediately instead of waiting for the next poll.
      const res2 = await fetch(`/api/conversations/${selectedId}/messages`);
      const data2 = await res2.json();
      if (res2.ok) {
        setDetail(data2.conversation);
        setMessages(data2.messages ?? []);
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplySending(false);
    }
  }

  return (
    <div>
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
                      <span style={{ flexShrink: 0, fontSize: 11, color: colors.mutedText }}>
                        {new Date(conv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: space.xs, display: "flex", flexDirection: "column", gap: space.xxs, maxHeight: 480 }}>
                {messages.length === 0 && (
                  <p style={{ color: colors.mutedText, fontSize: 13, margin: "auto" }}>No messages in this conversation yet.</p>
                )}
                {messages.map((m) => {
                  const isInbound = m.direction === "INBOUND";
                  const text = messageText(m);
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: isInbound ? "flex-start" : "flex-end" }}>
                      <div
                        style={{
                          maxWidth: "70%",
                          background: isInbound ? colors.canvas : colors.primary,
                          color: isInbound ? colors.ink : colors.onPrimary,
                          border: isInbound ? `1px solid ${colors.hairline}` : "none",
                          borderRadius: 10,
                          padding: "8px 12px",
                        }}
                      >
                        {m.mediaId && isImage(m) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/whatsapp/media/${m.mediaId}`}
                            alt="Attachment"
                            style={{ maxWidth: "100%", borderRadius: 6, display: "block", marginBottom: text ? 6 : 0 }}
                          />
                        )}
                        {m.mediaId && !isImage(m) && (
                          <a
                            href={`/api/whatsapp/media/${m.mediaId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 13,
                              color: isInbound ? colors.ink : colors.onPrimary,
                              marginBottom: text ? 6 : 0,
                              textDecoration: "underline",
                            }}
                          >
                            <Paperclip size={13} />
                            {m.mimeType ?? m.type} attachment
                          </a>
                        )}
                        {text && <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</p>}
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
                          <span>{new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                          {!isInbound && <MessageStatusIndicator status={m.status} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              {/* Reply — reuses the existing sendOutbound() path via /api/conversations/[id]/reply */}
              <form
                onSubmit={handleSendReply}
                style={{ borderTop: `1px solid ${colors.hairline}`, padding: space.xs, display: "flex", flexDirection: "column", gap: 6 }}
              >
                {replyError && <p style={{ margin: 0, fontSize: 12, color: colors.semanticWarning }}>{replyError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type a reply…"
                    disabled={replySending}
                    style={{ ...fieldInput, flex: 1 }}
                  />
                  <button
                    type="submit"
                    disabled={!replyText.trim() || replySending}
                    style={{ ...buttonStyle("hero", !replyText.trim() || replySending), display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Send size={14} />
                    {replySending ? "Sending…" : "Reply"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
