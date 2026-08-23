import type { BuyingSignalLevel, RecommendedReply, SkillDecision } from "./types";

/**
 * JSON Schema for the extraction-stage structured output. Mirrors SkillDecision
 * exactly. Passed as `output_config.format` on the Haiku extraction call —
 * never used to change what the Skill itself outputs (SKILL.md's own output
 * contract stays plain text, per the constraint not to touch the Skill).
 */
export const SKILL_DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    clientAnalysis: {
      type: "object",
      properties: {
        clientSector: { type: "string" },
        clientType: { type: "string" },
        salesStage: { type: "string" },
        clientIntent: { type: "string" },
        psychologicalInterpretation: { type: "string" },
        buyingSignal: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
            evidence: { type: "string" },
          },
          required: ["level", "evidence"],
          additionalProperties: false,
        },
        mainConcern: { type: "string" },
        whatClientIsLookingFor: { type: "string" },
        // Not in `required` — deliberately optional. See ClientAnalysis.milestone
        // in types.ts for why this must stay best-effort, never parse-blocking.
        milestone: { type: "string", enum: ["none", "payment_intent", "payment_confirmed", "ready_to_start"] },
      },
      required: [
        "clientSector",
        "clientType",
        "salesStage",
        "clientIntent",
        "psychologicalInterpretation",
        "buyingSignal",
        "mainConcern",
        "whatClientIsLookingFor",
      ],
      additionalProperties: false,
    },
    salesStrategy: {
      type: "object",
      properties: {
        bestNextAction: { type: "string" },
        whatToAvoid: { type: "string" },
        objectiveOfReply: { type: "string" },
        behaviorAttachment: { type: "string" },
      },
      required: ["bestNextAction", "whatToAvoid", "objectiveOfReply"],
      additionalProperties: false,
    },
    recommendedReply: {
      anyOf: [
        {
          type: "object",
          properties: {
            kind: { const: "reply" },
            text: { type: "string" },
          },
          required: ["kind", "text"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "do_not_reply_yet" },
            reason: { type: "string" },
            trigger: { type: "string" },
          },
          required: ["kind", "reason", "trigger"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "do_not_follow_up_yet" },
            reason: { type: "string" },
            trigger: { type: "string" },
          },
          required: ["kind", "reason", "trigger"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["clientAnalysis", "salesStrategy", "recommendedReply"],
  additionalProperties: false,
} as const;

const BUYING_SIGNAL_LEVELS: readonly BuyingSignalLevel[] = ["LOW", "MEDIUM", "HIGH"];

function isRecommendedReply(value: unknown): value is RecommendedReply {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "reply") {
    return typeof v.text === "string";
  }
  if (v.kind === "do_not_reply_yet" || v.kind === "do_not_follow_up_yet") {
    return typeof v.reason === "string" && typeof v.trigger === "string";
  }
  return false;
}

/**
 * Structural validation of the extraction model's output against SkillDecision.
 * No library — hand-written so Phase 1 doesn't take on a schema-validation
 * dependency beyond the four approved ones.
 */
export function isSkillDecision(value: unknown): value is SkillDecision {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  const ca = v.clientAnalysis as Record<string, unknown> | undefined;
  if (typeof ca !== "object" || ca === null) return false;
  const stringFields = [
    "clientSector",
    "clientType",
    "salesStage",
    "clientIntent",
    "psychologicalInterpretation",
    "mainConcern",
    "whatClientIsLookingFor",
  ];
  if (!stringFields.every((field) => typeof ca[field] === "string")) return false;

  const buyingSignal = ca.buyingSignal as Record<string, unknown> | undefined;
  if (typeof buyingSignal !== "object" || buyingSignal === null) return false;
  if (
    !BUYING_SIGNAL_LEVELS.includes(buyingSignal.level as BuyingSignalLevel) ||
    typeof buyingSignal.evidence !== "string"
  ) {
    return false;
  }

  const ss = v.salesStrategy as Record<string, unknown> | undefined;
  if (typeof ss !== "object" || ss === null) return false;
  if (
    typeof ss.bestNextAction !== "string" ||
    typeof ss.whatToAvoid !== "string" ||
    typeof ss.objectiveOfReply !== "string"
  ) {
    return false;
  }
  if (ss.behaviorAttachment !== undefined && typeof ss.behaviorAttachment !== "string") {
    return false;
  }

  return isRecommendedReply(v.recommendedReply);
}

export type ExtractionParseResult =
  | { ok: true; decision: SkillDecision }
  | { ok: false; reason: string };

/**
 * Parses the extraction-stage model's raw text output (expected to be JSON
 * matching SKILL_DECISION_JSON_SCHEMA) into a typed SkillDecision, or a typed
 * failure reason. Never guesses a default on malformed output.
 */
export function parseExtractionOutput(rawText: string): ExtractionParseResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "extraction output was not valid JSON" };
  }

  if (!isSkillDecision(candidate)) {
    return { ok: false, reason: "extraction output did not match the SkillDecision shape" };
  }

  return { ok: true, decision: candidate };
}
