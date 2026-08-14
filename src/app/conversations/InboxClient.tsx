"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import Badge from "../_components/Badge";
import { colors, space, sectionStyle } from "../_lib/ui-tokens";
import { CONVERSATION_STATUS_DISPLAY, type DerivedConversationStatus } from "../_lib/conversation-status";

export interface ConversationSummary {
  id: string;
  lead: { phoneE164: string; name: string | null };
  campaign: { name: string } | null;
  status: DerivedConversationStatus;
  lastMessage: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  updatedAt: string;
}

interface MessageItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  type: string;
  templateName: string | null;
  status: string;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  lead: { phoneE164: string; name: string | null };
  campaign: { name: string } | null;
  status: DerivedConversationStatus;
}

const LIST_POLL_MS = 10_000;
const THREAD_POLL_MS = 5_000;

function leadLabel(lead: { phoneE164: string; name: string | null }): string {
  return lead.name ?? lead.phoneE164;
}

function messageText(m: MessageItem): string {
  if (m.body) return m.body;
  if (m.templateName) return `Template: ${m.templateName}`;
  return `[${m.type}]`;
}

/**
 * Inbox — read-only two-pane view over the existing Conversation/Message
 * data (list pane + thread pane), polling the two new GET-only API routes
 * (/api/conversations, /api/conversations/[id]/messages) so it picks up
 * whatever the existing webhook -> handle-inbound -> send-ai-reply pipeline
 * has already persisted. No new send path — see the Send page for outbound.
 */
export default function InboxClient({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

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

  async function handleDeleteConversation(e: React.MouseEvent, id: string, label: string) {
    e.stopPropagation();
    if (!window.confirm(`Delete conversation with ${label}? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error ?? "Failed to delete conversation");
        return;
      }
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space.sm, alignItems: "flex-start" }}>
      {/* List pane */}
      <section style={{ ...sectionStyle, width: 340, flexShrink: 0, padding: 0, overflow: "hidden" }}>
        <div style={{ maxHeight: 640, overflowY: "auto" }}>
          {conversations.length === 0 && (
            <p style={{ color: colors.mutedText, fontSize: 13, padding: space.md, margin: 0 }}>No conversations yet.</p>
          )}
          {conversations.map((conv) => {
            const isSelected = conv.id === selectedId;
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
                  display: "block",
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: space.xxs }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {leadLabel(conv.lead)}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: colors.mutedText }}>
                      {new Date(conv.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conv.id, leadLabel(conv.lead))}
                      aria-label={`Delete conversation with ${leadLabel(conv.lead)}`}
                      title="Delete conversation"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        background: "transparent",
                        border: "none",
                        color: colors.semanticWarning,
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
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

            <div style={{ flex: 1, overflowY: "auto", padding: space.xs, display: "flex", flexDirection: "column", gap: space.xxs, maxHeight: 560 }}>
              {messages.length === 0 && (
                <p style={{ color: colors.mutedText, fontSize: 13, margin: "auto" }}>No messages in this conversation yet.</p>
              )}
              {messages.map((m) => {
                const isInbound = m.direction === "INBOUND";
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
                      <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{messageText(m)}</p>
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: 11,
                          color: isInbound ? colors.mutedText : colors.onPrimary,
                          textAlign: "right",
                        }}
                      >
                        {new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
