/**
 * Shape mirrors the Skill's §17 output contract exactly (SKILL.md,
 * "Output contract"). Do not add fields the Skill doesn't produce.
 */

export type BuyingSignalLevel = "LOW" | "MEDIUM" | "HIGH";

/** Private, operator-only alert signal — see SKILL.md §6 "Milestone detection". */
export type Milestone = "none" | "payment_intent" | "payment_confirmed" | "payment_proof_received" | "ready_to_start";

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
  /**
   * Optional and best-effort by design: absence, an unrecognized value, or a
   * model that simply forgets this line must NEVER fail SkillDecision parsing
   * or block the customer's actual WhatsApp reply — only ever used to
   * additively trigger an internal Telegram alert (send-telegram-notification
   * task), never read by the WhatsApp send path itself.
   */
  milestone?: Milestone;
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
  /**
   * Message.type/filename passed through so the Skill can know an image or
   * document was attached — never the actual file content. There is no
   * vision/multimodal capability anywhere in this codebase; this is only
   * ever rendered as a bracketed indicator (see build-prompt.ts), never
   * analyzed. Undefined/"text" means no media indicator is shown.
   */
  type?: string;
  filename?: string;
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

/**
 * Diagnostic-only, additive to every result variant. Not part of the
 * client-facing decision shape — never read by the WhatsApp send path or the
 * UI. Optional so providers that don't report timings (e.g. anthropic.ts)
 * need no changes.
 */
export interface SkillInvocationTimingsMs {
  proseCallMs: number;
  extractionCallMs: number;
  totalMs: number;
}

export type SkillInvocationResult =
  | { status: "success"; decision: SkillDecision; rawOutput: string; timingsMs?: SkillInvocationTimingsMs }
  | { status: "parse_failure"; reason: string; rawOutput: string; timingsMs?: SkillInvocationTimingsMs };
