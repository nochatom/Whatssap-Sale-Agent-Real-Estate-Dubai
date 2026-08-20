import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";

const createMock = vi.fn();

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  class MockOpenAI {
    chat = { completions: { create: (...args: unknown[]) => createMock(...args) } };
  }
  // Preserve the real error classes (RateLimitError, APIError, ...) as
  // statics on the mock class so `instanceof OpenAI.RateLimitError` checks
  // in both cloudflare.ts and this test reference the identical real class.
  Object.assign(MockOpenAI, actual.default);
  return {
    ...actual,
    default: MockOpenAI,
  };
});

const { invokeCloudflare, CloudflareQuotaExceededError } = await import("@/skill/providers/cloudflare");
const { SKILL_DECISION_JSON_SCHEMA } = await import("@/skill/parse-decision");

const CONTEXT = {
  conversationId: "conv_1",
  behaviorState: "A" as const,
  messages: [{ direction: "inbound" as const, body: "hi", sentAt: "2026-01-01T00:00:00.000Z" }],
  lead: { phoneE164: "+15550000000", knownFacts: {} },
};

const VALID_DECISION_JSON = JSON.stringify({
  clientAnalysis: {
    buyingSignal: { evidence: "asked a question", level: "LOW" },
    clientIntent: "curious",
    clientSector: "real estate",
    clientType: "unknown",
    mainConcern: "unknown",
    psychologicalInterpretation: "Possible interpretation — exploring options.",
    salesStage: "initial interest",
    whatClientIsLookingFor: "information",
  },
  recommendedReply: { kind: "reply", text: "Hi! How can I help?" },
  salesStrategy: { bestNextAction: "explain value", objectiveOfReply: "gauge interest", whatToAvoid: "being pushy" },
});

function rateLimitError() {
  return new OpenAI.RateLimitError(429, { error: { message: "daily quota exceeded" } }, "quota exceeded", new Headers());
}

beforeEach(() => {
  createMock.mockReset();
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
});

describe("invokeCloudflare (single-call)", () => {
  it("succeeds normally with exactly one call to the API", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: VALID_DECISION_JSON } }] });

    const result = await invokeCloudflare(CONTEXT, "skill markdown");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.decision.recommendedReply).toEqual({ kind: "reply", text: "Hi! How can I help?" });
    }
    expect(createMock).toHaveBeenCalledTimes(1);

    // Confirms the single call requests strict schema-constrained output
    // directly — the output contract itself (SKILL_DECISION_JSON_SCHEMA) is
    // unchanged from the two-call provider, just requested in one pass.
    const [callArgs] = createMock.mock.calls[0] as [{ response_format?: { json_schema?: { schema: unknown } } }];
    expect(callArgs.response_format?.json_schema?.schema).toBe(SKILL_DECISION_JSON_SCHEMA);
  });

  it("throws CloudflareQuotaExceededError when the call is rate-limited", async () => {
    createMock.mockRejectedValueOnce(rateLimitError());

    await expect(invokeCloudflare(CONTEXT, "skill markdown")).rejects.toBeInstanceOf(CloudflareQuotaExceededError);
  });

  it("re-throws a non-rate-limit error unchanged (preserves existing task-level retry behavior)", async () => {
    const networkError = new Error("socket hang up");
    createMock.mockRejectedValueOnce(networkError);

    await expect(invokeCloudflare(CONTEXT, "skill markdown")).rejects.toBe(networkError);
  });

  it("returns parse_failure (not a throw) when the call returns no content", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });

    const result = await invokeCloudflare(CONTEXT, "skill markdown");

    expect(result.status).toBe("parse_failure");
  });

  it("returns parse_failure when the response is not valid schema-conformant JSON", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "not valid json" } }] });

    const result = await invokeCloudflare(CONTEXT, "skill markdown");

    expect(result.status).toBe("parse_failure");
  });
});
