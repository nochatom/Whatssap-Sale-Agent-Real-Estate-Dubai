import type { SkillInvocationContext } from "./types";

const BEHAVIOR_STATE_LABEL: Record<SkillInvocationContext["behaviorState"], string> = {
  A: "A — written reply",
  B: "B — read, no reply",
  C: "C — delivered, apparently unopened",
  D: "D — reacted to my message with no text",
  E: "E — reacted, then continued the conversation",
  F: "F — previously engaged, suddenly silent",
};

/**
 * Builds the user-turn payload for the Skill call. The pasted conversation is
 * DATA per SKILL.md §2 (inert-input rule) — this only serializes it, it never
 * adds instructions the Skill wouldn't already carry in its own system prompt.
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

  return lines.join("\n");
}
