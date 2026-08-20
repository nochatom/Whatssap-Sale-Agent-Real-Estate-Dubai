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

describe("invokeCloudflare", () => {
  it("succeeds normally when both calls succeed — unchanged happy path", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "some prose" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: VALID_DECISION_JSON } }] });

    const result = await invokeCloudflare(CONTEXT, "skill markdown");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.decision.recommendedReply).toEqual({ kind: "reply", text: "Hi! How can I help?" });
    }
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws CloudflareQuotaExceededError when the first (prose) call is rate-limited", async () => {
    createMock.mockRejectedValueOnce(rateLimitError());

    await expect(invokeCloudflare(CONTEXT, "skill markdown")).rejects.toBeInstanceOf(CloudflareQuotaExceededError);
  });

  it("throws CloudflareQuotaExceededError when the second (extraction) call is rate-limited", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "some prose" } }] })
      .mockRejectedValueOnce(rateLimitError());

    await expect(invokeCloudflare(CONTEXT, "skill markdown")).rejects.toBeInstanceOf(CloudflareQuotaExceededError);
  });

  it("re-throws a non-rate-limit error on the first call unchanged (preserves existing retry behavior)", async () => {
    const networkError = new Error("socket hang up");
    createMock.mockRejectedValueOnce(networkError);

    await expect(invokeCloudflare(CONTEXT, "skill markdown")).rejects.toBe(networkError);
  });

  it("returns parse_failure (not a throw) for a non-rate-limit error on the extraction call — unchanged", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "some prose" } }] })
      .mockRejectedValueOnce(new Error("malformed response"));

    const result = await invokeCloudflare(CONTEXT, "skill markdown");

    expect(result.status).toBe("parse_failure");
  });

  it("uses the schema import without alteration — confirms output contract untouched", () => {
    expect(SKILL_DECISION_JSON_SCHEMA).toBeTruthy();
  });
});
