import { describe, expect, it } from "vitest";

import { isSkillDecision, parseExtractionOutput } from "@/skill/parse-decision";
import type { SkillDecision } from "@/skill/types";

const VALID_DECISION: SkillDecision = {
  clientAnalysis: {
    clientSector: "Airbnb host",
    clientType: "one",
    salesStage: "asking for price",
    clientIntent: "wants a quote before committing",
    psychologicalInterpretation: "Most likely comparing suppliers on price.",
    buyingSignal: { level: "MEDIUM", evidence: "asked how much" },
    mainConcern: "price versus other suppliers",
    whatClientIsLookingFor: "a fair price with fast delivery",
  },
  salesStrategy: {
    bestNextAction: "give a price",
    whatToAvoid: "overselling before scope is confirmed",
    objectiveOfReply: "get the property link and confirm scope",
  },
  recommendedReply: {
    kind: "reply",
    text: "Happy to help — could you share the property link so I can confirm scope?",
  },
};

describe("isSkillDecision", () => {
  it("accepts a well-formed decision", () => {
    expect(isSkillDecision(VALID_DECISION)).toBe(true);
  });

  it("accepts a do_not_reply_yet reply variant", () => {
    const decision = {
      ...VALID_DECISION,
      recommendedReply: {
        kind: "do_not_reply_yet",
        reason: "message was just delivered, not yet read",
        trigger: "wait until read receipt or 24 hours",
      },
    };
    expect(isSkillDecision(decision)).toBe(true);
  });

  it("rejects an invalid buying signal level", () => {
    const decision = {
      ...VALID_DECISION,
      clientAnalysis: {
        ...VALID_DECISION.clientAnalysis,
        buyingSignal: { level: "SUPER_HIGH", evidence: "x" },
      },
    };
    expect(isSkillDecision(decision)).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { mainConcern, ...rest } = VALID_DECISION.clientAnalysis;
    const decision = { ...VALID_DECISION, clientAnalysis: rest };
    expect(isSkillDecision(decision)).toBe(false);
  });

  it("rejects an unrecognized recommendedReply.kind", () => {
    const decision = { ...VALID_DECISION, recommendedReply: { kind: "maybe", text: "x" } };
    expect(isSkillDecision(decision)).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isSkillDecision("not an object")).toBe(false);
    expect(isSkillDecision(null)).toBe(false);
    expect(isSkillDecision(undefined)).toBe(false);
  });
});

describe("parseExtractionOutput", () => {
  it("returns ok with the parsed decision for valid JSON", () => {
    const result = parseExtractionOutput(JSON.stringify(VALID_DECISION));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toEqual(VALID_DECISION);
    }
  });

  it("returns a typed failure for malformed JSON, never a guessed default", () => {
    const result = parseExtractionOutput("{not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not valid JSON/);
    }
  });

  it("returns a typed failure when JSON is valid but doesn't match the shape", () => {
    const result = parseExtractionOutput(JSON.stringify({ foo: "bar" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/did not match/);
    }
  });
});
