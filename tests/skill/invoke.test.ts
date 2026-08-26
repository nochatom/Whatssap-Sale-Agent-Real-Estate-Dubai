import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeCloudflareMock = vi.fn();
const invokeQwenMock = vi.fn();
const invokeOxAlphaMock = vi.fn();

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

vi.mock("@/skill/providers/oxalpha", () => ({
  invokeOxAlpha: (...args: unknown[]) => invokeOxAlphaMock(...args),
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
const originalQwenKey = process.env.QWEN_API_KEY;
const originalCloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const originalCloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  invokeCloudflareMock.mockReset();
  invokeQwenMock.mockReset();
  invokeOxAlphaMock.mockReset();
  process.env.QWEN_API_KEY = "test-qwen-key";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account-id";
  process.env.CLOUDFLARE_API_TOKEN = "test-api-token";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});

afterEach(() => {
  if (originalAiProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalAiProvider;
  if (originalQwenKey === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = originalQwenKey;
  if (originalCloudflareAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccountId;
  if (originalCloudflareApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = originalCloudflareApiToken;
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
});

describe("invokeSkill — AI_PROVIDER is ignored entirely (the actual bug fix)", () => {
  it("still tries Ox Alpha first when AI_PROVIDER=cloudflare — the exact production misconfiguration this fixes", async () => {
    process.env.AI_PROVIDER = "cloudflare";
    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("still tries Ox Alpha first when AI_PROVIDER=qwen", async () => {
    process.env.AI_PROVIDER = "qwen";
    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
  });

  it("still tries Ox Alpha first when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER;
    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
  });

  it("still tries Ox Alpha first when AI_PROVIDER is an unrecognized/garbage value", async () => {
    process.env.AI_PROVIDER = "some-garbage-value";
    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
  });

  it("falls all the way to Cloudflare even when AI_PROVIDER=cloudflare — no early exit to a single named provider", async () => {
    process.env.AI_PROVIDER = "cloudflare";
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });
});

describe("invokeSkill — Ox Alpha -> Qwen -> Cloudflare chain", () => {
  it("returns Ox Alpha's result directly when it succeeds — Qwen and Cloudflare never called", async () => {
    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(result).toEqual(SUCCESS_RESULT);
    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
  });

  it("falls back to Qwen on ANY Ox Alpha error — not just a specific error type", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 429 rate limited"));
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls back to Qwen with the identical context and Skill markdown Ox Alpha received", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: timeout"));
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    const [oxContext, oxSkillMarkdown] = invokeOxAlphaMock.mock.calls[0] ?? [];
    const [qwenContext, qwenSkillMarkdown] = invokeQwenMock.mock.calls[0] ?? [];
    expect(qwenContext).toEqual(oxContext);
    expect(qwenSkillMarkdown).toBe(oxSkillMarkdown);
  });

  it("falls all the way to Cloudflare when both Ox Alpha and Qwen fail", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
    expect(invokeQwenMock).toHaveBeenCalledOnce();
    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("falls back to Cloudflare with the identical context and Skill markdown Qwen received", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: timeout"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    await invokeSkill(CONTEXT);

    const [qwenContext, qwenSkillMarkdown] = invokeQwenMock.mock.calls[0] ?? [];
    const [cfContext, cfSkillMarkdown] = invokeCloudflareMock.mock.calls[0] ?? [];
    expect(cfContext).toEqual(qwenContext);
    expect(cfSkillMarkdown).toBe(qwenSkillMarkdown);
  });

  it("skips straight to Cloudflare when Ox Alpha fails and Qwen credentials are unset", async () => {
    delete process.env.QWEN_API_KEY;
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 429"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

    const result = await invokeSkill(CONTEXT);

    expect(invokeQwenMock).not.toHaveBeenCalled();
    expect(invokeCloudflareMock).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS_RESULT);
  });

  it("does NOT invent a reply when all three fail", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
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
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));

    const result = await invokeSkill(CONTEXT);

    expect(invokeCloudflareMock).not.toHaveBeenCalled();
    expect(result.status).toBe("parse_failure");
    if (result.status === "parse_failure") {
      expect(result.reason).toMatch(/no fallback provider configured/);
    }
  });

  it("marks a triple-failure as retryable when Cloudflare's own failure is specifically quota-exceeded", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockRejectedValueOnce(new CloudflareQuotaExceededError(new Error("429")));

    const result = await invokeSkill(CONTEXT);

    expect(isRetryableProviderUnavailable(result)).toBe(true);
  });

  it("does NOT mark a triple-failure as retryable when Cloudflare's failure is not quota-related", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
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

  it("always restarts at Ox Alpha on the next call, regardless of what the previous call fell back to", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 429"));
    invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const first = await invokeSkill(CONTEXT);
    expect(first).toEqual(SUCCESS_RESULT);
    expect(invokeOxAlphaMock).toHaveBeenCalledTimes(1);
    expect(invokeQwenMock).toHaveBeenCalledTimes(1);

    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const second = await invokeSkill(CONTEXT);
    expect(second).toEqual(SUCCESS_RESULT);
    expect(invokeOxAlphaMock).toHaveBeenCalledTimes(2);
    expect(invokeQwenMock).toHaveBeenCalledTimes(1); // not called again on the second request
  });

  it("even after falling all the way to Cloudflare, the next independent request still starts at Ox Alpha", async () => {
    invokeOxAlphaMock.mockRejectedValueOnce(new Error("Ox Alpha: 503"));
    invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
    invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const first = await invokeSkill(CONTEXT);
    expect(first).toEqual(SUCCESS_RESULT);

    invokeOxAlphaMock.mockResolvedValueOnce(SUCCESS_RESULT);
    const second = await invokeSkill(CONTEXT);
    expect(second).toEqual(SUCCESS_RESULT);
    expect(invokeOxAlphaMock).toHaveBeenCalledTimes(2);
    expect(invokeQwenMock).toHaveBeenCalledTimes(1);
    expect(invokeCloudflareMock).toHaveBeenCalledTimes(1);
  });

  describe("returned parse_failure is ALSO fallback-worthy (not just a thrown error)", () => {
    const PARSE_FAILURE_RESULT = {
      status: "parse_failure" as const,
      reason: "extraction call returned malformed JSON",
      rawOutput: "not valid json",
    };

    it("falls back to Qwen when Ox Alpha RETURNS a parse_failure (no throw)", async () => {
      invokeOxAlphaMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeQwenMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeQwenMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });

    it("falls back to Cloudflare when Ox Alpha's parse_failure is followed by Qwen ALSO returning a parse_failure", async () => {
      invokeOxAlphaMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeQwenMock.mockResolvedValueOnce({ ...PARSE_FAILURE_RESULT, reason: "Qwen: missing required fields" });
      invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeOxAlphaMock).toHaveBeenCalledOnce();
      expect(invokeQwenMock).toHaveBeenCalledOnce();
      expect(invokeCloudflareMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });

    it("mixes a returned parse_failure (Ox Alpha) with a thrown error (Qwen) correctly", async () => {
      invokeOxAlphaMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeQwenMock.mockRejectedValueOnce(new Error("Qwen: 503"));
      invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeCloudflareMock).toHaveBeenCalledOnce();
      expect(result).toEqual(SUCCESS_RESULT);
    });

    it("returns Cloudflare's OWN parse_failure directly, unescalated — Cloudflare is the terminal stage", async () => {
      invokeOxAlphaMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
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
      invokeOxAlphaMock.mockResolvedValueOnce(doNotReplyResult);

      const result = await invokeSkill(CONTEXT);

      expect(invokeQwenMock).not.toHaveBeenCalled();
      expect(invokeCloudflareMock).not.toHaveBeenCalled();
      expect(result).toEqual(doNotReplyResult);
    });

    it("skips straight to Cloudflare on an Ox Alpha parse_failure when Qwen credentials are unset", async () => {
      delete process.env.QWEN_API_KEY;
      invokeOxAlphaMock.mockResolvedValueOnce(PARSE_FAILURE_RESULT);
      invokeCloudflareMock.mockResolvedValueOnce(SUCCESS_RESULT);

      const result = await invokeSkill(CONTEXT);

      expect(invokeQwenMock).not.toHaveBeenCalled();
      expect(invokeCloudflareMock).toHaveBeenCalledOnce();
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
