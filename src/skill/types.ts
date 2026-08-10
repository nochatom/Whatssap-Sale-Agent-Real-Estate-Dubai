/**
 * Shape mirrors the Skill's §17 output contract exactly (SKILL.md,
 * "Output contract"). Do not add fields the Skill doesn't produce.
 */

export type BuyingSignalLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ClientAnalysis {
  clientSector: string;
  clientType: string;
  salesStage: string;
  clientIntent: string;
  psychologicalInterpretation: string;
  buyingSignal: {
    level: BuyingSignalLevel;
    evidence: string;
  };
  mainConcern: string;
  whatClientIsLookingFor: string;
}

export interface SalesStrategy {
  bestNextAction: string;
  whatToAvoid: string;
  objectiveOfReply: string;
  /** Required by §17 for WhatsApp behavior states B, C, D, F. */
  behaviorAttachment?: string;
}

export type RecommendedReply =
  | { kind: "reply"; text: string }
  | { kind: "do_not_reply_yet"; reason: string; trigger: string }
  | { kind: "do_not_follow_up_yet"; reason: string; trigger: string };

export interface SkillDecision {
  clientAnalysis: ClientAnalysis;
  salesStrategy: SalesStrategy;
  recommendedReply: RecommendedReply;
}

/** WhatsApp behavior state per SKILL.md §8. */
export type WhatsAppBehaviorState = "A" | "B" | "C" | "D" | "E" | "F";

export interface SkillInputMessage {
  direction: "inbound" | "outbound";
  body: string;
  sentAt: string;
  reaction?: string;
}

export interface SkillInvocationContext {
  conversationId: string;
  behaviorState: WhatsAppBehaviorState;
  messages: SkillInputMessage[];
  lead: {
    phoneE164: string;
    knownFacts: Record<string, unknown>;
  };
}

export type SkillInvocationResult =
  | { status: "success"; decision: SkillDecision; rawOutput: string }
  | { status: "parse_failure"; reason: string; rawOutput: string };
