import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeCloudflareMock = vi.fn();
const invokeAnthropicMock = vi.fn();

vi.mock("@/skill/providers/cloudflare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/skill/providers/cloudflare")>();
  return {
    ...actual,
    invokeCloudflare: (...args: unknown[]) => invokeCloudflareMock(...args),
  };
});

vi.mock("@/skill/providers/anthropic", () => ({
  invokeAnthropic: (...args: unknown[]) => invokeAnthropicMock(...args),
}));

const { invokeSkill } = await import("@/skill/invoke");
const { CloudflareQuotaExceededError } = await import("@/skill/providers/cloudflare");

const CONTEXT = {
  conversationId: "conv_1",
  behaviorState: "A" as const,
  messages: [{ direction: "inbound" as const, body: "hi", sentAt: "2026-01-01T00:00:00.000Z" }],
  lead: { phoneE164: "+15550000000", knownFacts: {} },
};

const SUCCESS_RESULT = {
  status: "success" as const,
  rawOutput: "prose",
  decision: {
    clientAnalysis: {
      buyingSignal: { evidence: "e", level: "LOW" as const },
      clientIntent: "i",
      clientSector: "s",
      clientType: "t",
      mainConcern: "m",
      psychologicalInterpretation: "p",
      salesStage: "ss",
      whatClientIsLookingFor: "w",
    },
    recommendedReply: { kind: "reply" as const, text: "Hi!" },
    salesStrategy: { bestNextAction: "b", objectiveOfReply: "o", whatToAvoid: "wa" },
  },
};

const originalAiProvider = process.env.AI_PROVIDER;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  invokeCloudflareMock.mockReset();
  invokeAnthropicMock.mockReset();
  process.env.AI_PROVIDER = "cloudflare";
});

afterEach(() => {
  if (originalAiProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalAiProvider;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

describe("invokeSkill — normal path", () => {
  it("returns Cloudflare's result directly when it succeeds — Anthropic never called", async () => {
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(invokeAnthropicMock).not.toHaveBeenCalled();
  });

  it("propagates a non-quota error uncaught — preserves existing task-level retry behavior", async () => {
    const networkError = new Error("socket hang up");
    invokeCloudflareMock.mockRejectedValueOnce(networkError);

    await expect(invokeSkill(CONTEXT)).rejects.toBe(networkError);
    expect(invokeAnthropicMock).not.toHaveBeenCalled();
  });
});

describe("invokeSkill — Cloudflare quota fallback", () => {
  it("falls back to Anthropic when Cloudflare is quota-exceeded and ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));
    invokeAnthropicMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeAnthropicMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("does NOT invent a reply and does not call Anthropic when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));

    const result = await invokeSkill(CONTEXT);

    expect(invokeAnthropicMock).not.toHaveBeenCalled();
    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/provider_unavailable/);
      expect(result.reason).toMatch(/no fallback provider configured/);
    }
  });

  it("does NOT invent a reply when Anthropic is configured but also fails", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));
    invokeAnthropicMock.mockRejectedValueOnce(new Error("Anthropic: insufficient credit"));

    const result = await invokeSkill(CONTEXT);

    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/provider_unavailable/);
      expect(result.reason).toMatch(/fallback to Anthropic also failed/);
    }
  });
});
