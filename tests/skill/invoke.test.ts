import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeCloudflareMock = vi.fn();
const invokeAnthropicMock = vi.fn();
const invokeGeminiMock = vi.fn();
const invokeQwenMock = vi.fn();

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

vi.mock("@/skill/providers/gemini", () => ({
  invokeGemini: (...args: unknown[]) => invokeGeminiMock(...args),
}));

vi.mock("@/skill/providers/qwen", () => ({
  invokeQwen: (...args: unknown[]) => invokeQwenMock(...args),
}));

const { invokeSkill, isRetryableProviderUnavailable, nextCloudflareQuotaResetAt } = await import("@/skill/invoke");
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
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalQwenKey = process.env.QWEN_API_KEY;
const originalCloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const originalCloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;

beforeEach(() => {
  invokeCloudflareMock.mockReset();
  invokeAnthropicMock.mockReset();
  invokeGeminiMock.mockReset();
  invokeQwenMock.mockReset();
  process.env.AI_PROVIDER = "cloudflare";
});

afterEach(() => {
  if (originalAiProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalAiProvider;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalQwenKey === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = originalQwenKey;
  if (originalCloudflareAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccountId;
  if (originalCloudflareApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = originalCloudflareApiToken;
});

describe("invokeSkill — normal path", () => {
  it("returns Cloudflare's result directly when it succeeds — Anthropic never called", async () => {
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(invokeAnthropicMock).not.toHaveBeenCalled();
  });

  it("propagates a non-quota Cloudflare error uncaught — preserves existing task-level retry behavior", async () => {
    const networkError = new Error("socket hang up");
    invokeCloudflareMock.mockRejectedValueOnce(networkError);

    await expect(invokeSkill(CONTEXT)).rejects.toBe(networkError);
    expect(invokeAnthropicMock).not.toHaveBeenCalled();
  });
});

describe("invokeSkill — Cloudflare quota fallback (unchanged)", () => {
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

  it("marks the no-fallback-configured failure as retryable", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(true);
  });

  it("does NOT mark an Anthropic-also-failed result as retryable (retrying at Cloudflare's reset wouldn't help)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));
    invokeAnthropicMock.mockRejectedValueOnce(new Error("Anthropic: insufficient credit"));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(false);
  });

  it("does NOT mark a successful result as retryable", () => {
    expect(isRetryableProviderUnavailable(SUCCESS_RESULT)).toBe(false);
  });

  it("does NOT mark an ordinary parse_failure (bad output) as retryable", () => {
    expect(
      isRetryableProviderUnavailable({ status: "parse_failure", reason: "extraction call failed: bad json", rawOutput: "x" }),
    ).toBe(false);
  });

  it("never calls Gemini on the Cloudflare primary path", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));
    invokeAnthropicMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeGeminiMock).not.toHaveBeenCalled();
  });
});

describe("invokeSkill — Claude primary, Gemini fallback (new)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "anthropic";
  });

  it("returns Claude's result directly when it succeeds — Gemini never called", async () => {
    invokeAnthropicMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(invokeGeminiMock).not.toHaveBeenCalled();
  });

  it("falls back to Gemini on ANY Claude error — not just a specific error type (quota/rate-limit/timeout/other)", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    invokeAnthropicMock.mockRejectedValueOnce(new Error("Anthropic: request timed out"));
    invokeGeminiMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGeminiMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls back to Gemini with the identical context and Skill markdown Claude received", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    invokeAnthropicMock.mockRejectedValueOnce(new Error("insufficient_quota"));
    invokeGeminiMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeAnthropicMock.mock.calls[0]).toBeDefined();
    expect(invokeGeminiMock.mock.calls[0]).toBeDefined();
    const [claudeContext, claudeSkillMarkdown] = invokeAnthropicMock.mock.calls[0] ?? [];
    const [geminiContext, geminiSkillMarkdown] = invokeGeminiMock.mock.calls[0] ?? [];
    expect(geminiContext).toEqual(claudeContext);
    expect(geminiSkillMarkdown).toBe(claudeSkillMarkdown);
  });

  it("does NOT invent a reply and does not call Gemini when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    invokeAnthropicMock.mockRejectedValueOnce(new Error("Claude: exhausted credits"));

    const result = await invokeSkill(CONTEXT);

    expect(invokeGeminiMock).not.toHaveBeenCalled();
    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/provider_unavailable/);
      expect(result.reason).toMatch(/no fallback provider configured/);
    }
  });

  it("fails gracefully — no invented reply — when Gemini's free quota is also exhausted", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    invokeAnthropicMock.mockRejectedValueOnce(new Error("Claude: rate limited"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("429 quota_exceeded"));

    const result = await invokeSkill(CONTEXT);

    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/provider_unavailable/);
      expect(result.reason).toMatch(/fallback to Gemini also failed/);
    }
  });

  it("does NOT mark a Claude+Gemini double-failure as retryable — no fixed reset time to reschedule against", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    invokeAnthropicMock.mockRejectedValueOnce(new Error("Claude: exhausted credits"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("429 quota_exceeded"));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(false);
  });

  it("never calls Qwen on the Claude primary path", async () => {
    invokeAnthropicMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeQwenMock).not.toHaveBeenCalled();
  });
});

describe("invokeSkill — Qwen primary, Cloudflare fallback (new)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "qwen";
    process.env.CLOUDFLARE_ACCOUNT_ID = "test-account-id";
    process.env.CLOUDFLARE_API_TOKEN = "test-api-token";
  });

  it("is the default provider when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER;
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(invokeAnthropicMock).not.toHaveBeenCalled();
    expect(invokeGeminiMock).not.toHaveBeenCalled();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("returns Qwen's result directly when it succeeds — Cloudflare never called", async () => {
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
  });

  it("falls back to Cloudflare on ANY Qwen error — not just a specific error type", async () => {
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503 bad_response_status_code"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls back to Cloudflare with the identical context and Skill markdown Qwen received", async () => {
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: timeout"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeQwenMock.mock.calls[0]).toBeDefined();
    expect(invokeCloudflareMock.mock.calls[0]).toBeDefined();
    const [qwenContext, qwenSkillMarkdown] = invokeQwenMock.mock.calls[0] ?? [];
    const [cloudflareContext, cloudflareSkillMarkdown] = invokeCloudflareMock.mock.calls[0] ?? [];
    expect(cloudflareContext).toEqual(qwenContext);
    expect(cloudflareSkillMarkdown).toBe(qwenSkillMarkdown);
  });

  it("does NOT invent a reply and does not call Cloudflare when its credentials are unset", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503 bad_response_status_code"));

    const result = await invokeSkill(CONTEXT);

    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/provider_unavailable/);
      expect(result.reason).toMatch(/no fallback provider configured/);
    }
  });

  it("fails gracefully — no invented reply — when Cloudflare is also quota-exceeded", async () => {
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503 bad_response_status_code"));
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));

    const result = await invokeSkill(CONTEXT);

    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/fallback to Cloudflare also failed/);
    }
  });

  it("marks a Qwen+Cloudflare-quota double-failure as retryable — Cloudflare's reset time still applies", async () => {
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503 bad_response_status_code"));
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(true);
  });

  it("does NOT mark a Qwen+Cloudflare-other-error double-failure as retryable", async () => {
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503 bad_response_status_code"));
    invokeCloudflareMock.mockRejectedValueOnce(new Error("Cloudflare: bad config"));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(false);
  });

  it("never calls Anthropic or Gemini on the Qwen primary path", async () => {
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503 bad_response_status_code"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeAnthropicMock).not.toHaveBeenCalled();
    expect(invokeGeminiMock).not.toHaveBeenCalled();
  });
});

describe("nextCloudflareQuotaResetAt", () => {
  it("returns the next 00:00 UTC boundary, a few minutes of jitter later", () => {
    const now = new Date("2026-08-20T15:30:00.000Z");
    const resetAt = nextCloudflareQuotaResetAt(now);

    const expectedFloor = new Date("2026-08-21T00:00:00.000Z").getTime();
    const expectedCeiling = expectedFloor + 5 * 60_000;

    expect(resetAt.getTime()).toBeGreaterThanOrEqual(expectedFloor);
    expect(resetAt.getTime()).toBeLessThanOrEqual(expectedCeiling);
  });

  it("rolls over correctly when called right before midnight UTC", () => {
    const now = new Date("2026-08-20T23:59:00.000Z");
    const resetAt = nextCloudflareQuotaResetAt(now);

    expect(resetAt.getTime()).toBeGreaterThanOrEqual(new Date("2026-08-21T00:00:00.000Z").getTime());
    expect(resetAt.getUTCDate()).toBe(21);
  });
});
