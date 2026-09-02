import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeCloudflareMock = vi.fn();
const invokeQwenMock = vi.fn();
const invokeGeminiMock = vi.fn();
const invokeGrokMock = vi.fn();

vi.mock("@/skill/providers/cloudflare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/skill/providers/cloudflare")>();
  return {
    ...actual,
    invokeCloudflare: (...args: unknown[]) => invokeCloudflareMock(...args),
  };
});

vi.mock("@/skill/providers/qwen", () => ({
  invokeQwen: (...args: unknown[]) => invokeQwenMock(...args),
}));

vi.mock("@/skill/providers/gemini", () => ({
  invokeGemini: (...args: unknown[]) => invokeGeminiMock(...args),
}));

vi.mock("@/skill/providers/xai", () => ({
  invokeGrok: (...args: unknown[]) => invokeGrokMock(...args),
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
const originalXaiKey = process.env.XAI_API_KEY;
const originalQwenKey = process.env.QWEN_API_KEY;
const originalCloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const originalCloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
const originalGeminiKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  invokeCloudflareMock.mockReset();
  invokeQwenMock.mockReset();
  invokeGeminiMock.mockReset();
  invokeGrokMock.mockReset();
  process.env.XAI_API_KEY = "test-xai-key";
  process.env.QWEN_API_KEY = "test-qwen-key";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account-id";
  process.env.CLOUDFLARE_API_TOKEN = "test-api-token";
  process.env.GEMINI_API_KEY = "test-gemini-key";
});

afterEach(() => {
  if (originalAiProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalAiProvider;
  if (originalXaiKey === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = originalXaiKey;
  if (originalQwenKey === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = originalQwenKey;
  if (originalCloudflareAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccountId;
  if (originalCloudflareApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = originalCloudflareApiToken;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
});

describe("invokeSkill — AI_PROVIDER is ignored entirely (the actual bug fix)", () => {
  it("still tries Grok first when AI_PROVIDER=cloudflare — the exact production misconfiguration this fixes", async () => {
    process.env.AI_PROVIDER = "cloudflare";
    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
    expect(invokeGeminiMock).not.toHaveBeenCalled();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("still tries Grok first when AI_PROVIDER=qwen", async () => {
    process.env.AI_PROVIDER = "qwen";
    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
  });

  it("still tries Grok first when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER;
    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
  });

  it("still tries Grok first when AI_PROVIDER is an unrecognized/garbage value", async () => {
    process.env.AI_PROVIDER = "some-garbage-value";
    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
  });

  it("falls all the way to Cloudflare even when AI_PROVIDER=cloudflare — no early exit to a single named provider", async () => {
    process.env.AI_PROVIDER = "cloudflare";
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
    expect(invokeGeminiMock).toHaveBeenCalledOnce();
    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });
});

describe("invokeSkill — Grok -> Gemini -> Qwen -> Cloudflare chain", () => {
  it("returns Grok's result directly when it succeeds — nothing else called", async () => {
    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(invokeGeminiMock).not.toHaveBeenCalled();
    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
  });

  it("falls back to Gemini on ANY Grok error — not just a specific error type", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 429 rate limited"));
    invokeGeminiMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGeminiMock).toHaveBeenCalledOnce();
    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls back to Gemini with the identical context and Skill markdown Grok received", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: timeout"));
    invokeGeminiMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    const [grokContext, grokSkillMarkdown] = invokeGrokMock.mock.calls[0] ?? [];
    const [geminiContext, geminiSkillMarkdown] = invokeGeminiMock.mock.calls[0] ?? [];
    expect(geminiContext).toEqual(grokContext);
    expect(geminiSkillMarkdown).toBe(grokSkillMarkdown);
  });

  it("falls back to Qwen when both Grok and Gemini fail", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
    expect(invokeGeminiMock).toHaveBeenCalledOnce();
    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls all the way to Cloudflare when Grok, Gemini, and Qwen all fail", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGrokMock).toHaveBeenCalledOnce();
    expect(invokeGeminiMock).toHaveBeenCalledOnce();
    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls back to Cloudflare with the identical context and Skill markdown Qwen received", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: timeout"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    const [qwenContext, qwenSkillMarkdown] = invokeQwenMock.mock.calls[0] ?? [];
    const [cfContext, cfSkillMarkdown] = invokeCloudflareMock.mock.calls[0] ?? [];
    expect(cfContext).toEqual(qwenContext);
    expect(cfSkillMarkdown).toBe(qwenSkillMarkdown);
  });

  it("skips straight to Qwen when Grok fails and Gemini credentials are unset", async () => {
    delete process.env.GEMINI_API_KEY;
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 429"));
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGeminiMock).not.toHaveBeenCalled();
    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("skips straight to Cloudflare when Grok fails, Gemini credentials are unset, and Qwen credentials are unset", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.QWEN_API_KEY;
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 429"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeGeminiMock).not.toHaveBeenCalled();
    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("does NOT invent a reply when all four fail", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockRejectedValueOnce(new Error("Cloudflare: bad config"));

    const result = await invokeSkill(CONTEXT);

    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/provider_unavailable/);
      expect(result.reason).toMatch(/fallback to Cloudflare also failed/);
    }
  });

  it("does NOT invent a reply when Cloudflare credentials are unset at the terminal stage", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));

    const result = await invokeSkill(CONTEXT);

    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/no fallback provider configured/);
    }
  });

  it("marks a four-way failure as retryable when Cloudflare's own failure is specifically quota-exceeded", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(true);
  });

  it("does NOT mark a four-way failure as retryable when Cloudflare's failure is not quota-related", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockRejectedValueOnce(new Error("Cloudflare: bad config"));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(false);
  });

  it("does NOT mark a successful result as retryable", () => {
    expect(isRetryableProviderUnavailable(SUCCESS_RESULT)).toBe(false);
  });

  it("does NOT mark an ordinary parse_failure (bad output, not provider-unavailable) as retryable", () => {
    expect(
      isRetryableProviderUnavailable({ status: "parse_failure", reason: "extraction call failed: bad json", rawOutput: "x" }),
    ).toBe(false);
  });

  it("always restarts at Grok on the next call, regardless of what the previous call fell back to", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 429"));
    invokeGeminiMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const first = await invokeSkill(CONTEXT);
    expect(first).toEqual(SUCCESS_RESULT);
    expect(invokeGrokMock).toHaveBeenCalledTimes(1);
    expect(invokeGeminiMock).toHaveBeenCalledTimes(1);

    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const second = await invokeSkill(CONTEXT);
    expect(second).toEqual(SUCCESS_RESULT);
    expect(invokeGrokMock).toHaveBeenCalledTimes(2);
    expect(invokeGeminiMock).toHaveBeenCalledTimes(1); // not called again on the second request
  });

  it("even after falling all the way to Cloudflare, the next independent request still starts at Grok", async () => {
    invokeGrokMock.mockRejectedValueOnce(new Error("Grok: 503"));
    invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const first = await invokeSkill(CONTEXT);
    expect(first).toEqual(SUCCESS_RESULT);

    invokeGrokMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const second = await invokeSkill(CONTEXT);
    expect(second).toEqual(SUCCESS_RESULT);
    expect(invokeGrokMock).toHaveBeenCalledTimes(2);
    expect(invokeGeminiMock).toHaveBeenCalledTimes(1);
    expect(invokeQwenMock).toHaveBeenCalledTimes(1);
    expect(invokeCloudflareMock).toHaveBeenCalledTimes(1);
  });

  describe("returned parse_failure is ALSO fallback-worthy (not just a thrown error)", () => {
    const PARSE_FAILURE_RESULT = {
      status: "parse_failure" as const,
      reason: "extraction call returned malformed JSON",
      rawOutput: "not valid json",
    };

    it("falls back to Gemini when Grok RETURNS a parse_failure (no throw)", async () => {
      invokeGrokMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeGeminiMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeGeminiMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });

    it("falls back to Qwen when Grok's parse_failure is followed by Gemini ALSO returning a parse_failure", async () => {
      invokeGrokMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeGeminiMock.mockResolvedValueOnce({ ...PARSE_FAILURE_RESULT, reason: "Gemini: missing required fields" });
      invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeGrokMock).toHaveBeenCalledOnce();
      expect(invokeGeminiMock).toHaveBeenCalledOnce();
      expect(invokeQwenMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });

    it("mixes a returned parse_failure (Grok) with a thrown error (Gemini) correctly", async () => {
      invokeGrokMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeGeminiMock.mockRejectedValueOnce(new Error("Gemini: 503"));
      invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeQwenMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });

    it("returns Cloudflare's OWN parse_failure directly, unescalated — Cloudflare is the terminal stage", async () => {
      invokeGrokMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeGeminiMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeQwenMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      const cloudflareParseFailure = { ...PARSE_FAILURE_RESULT, reason: "Cloudflare: unparseable extraction output" };
      invokeCloudflareMock.mockResolvedValueOnce(cloudflareParseFailure);

      const result = await invokeSkill(CONTEXT);

      expect(result).toEqual(cloudflareParseFailure);
    });

    it("does NOT treat a successfully-parsed do_not_reply_yet decision as a failure requiring fallback", async () => {
      const doNotReplyResult = {
        status: "success" as const,
        rawOutput: "prose",
        decision: {
          ...SUCCESS_RESULT.decision,
          recommendedReply: { kind: "do_not_reply_yet" as const, reason: "client asked to think it over", trigger: "client replies again" },
        },
      };
      invokeGrokMock.mockResolvedValueOnce(doNotReplyResult);

      const result = await invokeSkill(CONTEXT);

      expect(invokeGeminiMock).not.toHaveBeenCalled();
      expect(invokeQwenMock).not.toHaveBeenCalled();
      expect(invokeCloudflareMock).not.toHaveBeenCalled();
      expect(result).toEqual(doNotReplyResult);
    });

    it("skips straight to Qwen on a Grok parse_failure when Gemini credentials are unset", async () => {
      delete process.env.GEMINI_API_KEY;
      invokeGrokMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeGeminiMock).not.toHaveBeenCalled();
      expect(invokeQwenMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });
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
