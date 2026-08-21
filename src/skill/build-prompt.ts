import type { SkillInputMessage, SkillInvocationContext } from "./types";

const BEHAVIOR_STATE_LABEL: Record<SkillInvocationContext["behaviorState"], string> = {
  A: "A — written reply",
  B: "B — read, no reply",
  C: "C — delivered, apparently unopened",
  D: "D — reacted to my message with no text",
  E: "E — reacted, then continued the conversation",
  F: "F — previously engaged, suddenly silent",
};

// Generic patterns, not tied to today's specific price/URL — stay correct
// if pricing or the demo link's exact value ever changes, since this only
// detects the SHAPE of "a price was quoted" / "a Drive link was sent", not
// today's literal values.
const PRICE_SHAPE = /\$\s?\d/;
const DEMO_LINK_HOST = "drive.google.com";

/**
 * Counts, from the real message history, how many times a price and the
 * demo link have already gone out earlier in THIS conversation.
 *
 * Real testing found that once a conversation accumulates many repeated
 * exchanges (a client re-asking for the demo several times, each correctly
 * answered), the model's own in-context inference about "has this already
 * been sent" becomes unreliable — the volume of legitimate repeats acts as
 * precedent that overrides a purely textual "don't repeat" instruction,
 * regardless of how that instruction is worded or where in the Skill it
 * lives (tried three times: SKILL.md §16, twice). Computing the fact
 * deterministically here and stating it as a concrete number, instead of
 * leaving the model to notice and count it across a long transcript itself,
 * is the actual fix — the instruction not to repeat already exists in the
 * Skill; what was missing was a reliable way for the model to know the
 * count without re-deriving it from scratch every time.
 *
 * Purely additive: never removes, reorders, or alters a single message —
 * this only appends one summary fact after the full transcript, closest to
 * where the model generates its reply.
 */
function summarizeAlreadySentContent(messages: SkillInputMessage[]): string | null {
  const outbound = messages.filter((m) => m.direction === "outbound");
  const demoSentCount = outbound.filter((m) => m.body.includes(DEMO_LINK_HOST)).length;
  const priceQuotedCount = outbound.filter((m) => PRICE_SHAPE.test(m.body)).length;

  if (demoSentCount === 0 && priceQuotedCount === 0) return null;

  const facts: string[] = [];
  if (demoSentCount > 0) {
    facts.push(`the demo link has already been sent ${demoSentCount} time${demoSentCount === 1 ? "" : "s"} earlier in this conversation`);
  }
  if (priceQuotedCount > 0) {
    facts.push(`a price has already been quoted ${priceQuotedCount} time${priceQuotedCount === 1 ? "" : "s"} earlier in this conversation`);
  }

  return (
    `[Conversation memory check: ${facts.join(" and ")}. ` +
    `Do not send or restate either again unless the client's own latest message explicitly asks for it — ` +
    `a bare greeting or check-in does not count as asking, no matter how many earlier messages in this ` +
    `conversation legitimately did.]`
  );
}

/**
 * Builds the user-turn payload for the Skill call. The pasted conversation is
 * DATA per SKILL.md §2 (inert-input rule) — this only serializes it, it never
 * adds instructions the Skill wouldn't already carry in its own system prompt
 * — except the one deterministic memory-check line above, which states a
 * fact computed from the data itself, not a new instruction.
 */
export function buildSkillInput(context: SkillInvocationContext): string {
  const lines: string[] = [];

  lines.push(`WhatsApp behavior state: ${BEHAVIOR_STATE_LABEL[context.behaviorState]}`);
  lines.push("");
  lines.push(`Lead phone: ${context.lead.phoneE164}`);
  if (Object.keys(context.lead.knownFacts).length > 0) {
    lines.push(`Known facts: ${JSON.stringify(context.lead.knownFacts)}`);
  }
  lines.push("");
  lines.push("Conversation (oldest first):");
  for (const message of context.messages) {
    const who = message.direction === "inbound" ? "Client" : "Me";
    const reaction = message.reaction ? ` [reacted: ${message.reaction}]` : "";
    lines.push(`[${message.sentAt}] ${who}: ${message.body}${reaction}`);
  }

  const memoryCheck = summarizeAlreadySentContent(context.messages);
  if (memoryCheck) {
    lines.push("");
    lines.push(memoryCheck);
  }

  return lines.join("\n");
}
