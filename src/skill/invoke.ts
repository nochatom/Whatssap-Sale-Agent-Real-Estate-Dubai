import { loadSkillMarkdown } from "./skill-file";
import { invokeAnthropic } from "./providers/anthropic";
import { CloudflareQuotaExceededError, invokeCloudflare } from "./providers/cloudflare";
import { invokeGemini } from "./providers/gemini";
import { invokeQwen } from "./providers/qwen";
import type { SkillProvider } from "./providers/types";
import type { SkillInvocationContext, SkillInvocationResult } from "./types";

// Throws at import time if any references/*.md the Skill routes to is missing.
// Phase 1 is expected to throw here until those files exist (see skill-file.ts) —
// this module must never be imported by a code path that runs in production
// without them, since the Skill cannot safely quote a price without offer-config.md.
const SKILL_MARKDOWN = loadSkillMarkdown();

const PROVIDERS: Record<string, SkillProvider> = {
  anthropic: invokeAnthropic,
  cloudflare: invokeCloudflare,
  gemini: invokeGemini,
  qwen: invokeQwen,
};

// Prefix identifying a parse_failure caused specifically by "no AI provider
// was reachable" (as opposed to a bad/unparseable output from a provider
// that DID respond). Only this specific failure is worth automatically
// retrying later — see isRetryableProviderUnavailable / send-ai-reply.ts.
// Used only on the Cloudflare primary path, which has a known, fixed
// "available again at" time (its daily UTC reset) to reschedule against —
// the Claude primary path below has no equivalent fixed time (an
// exhausted-credits failure doesn't resolve on a schedule), so its
// terminal failures are plain parse_failures, never this retryable marker.
const PROVIDER_UNAVAILABLE_RETRY_MARKER = "provider_unavailable_retry_after_quota_reset";

/**
 * True only when invokeSkill() failed because no AI provider could be
 * reached at all (Cloudflare quota-exhausted and no usable fallback) — never
 * for a provider that responded but produced bad output. send-ai-reply.ts
 * uses this to decide whether to reschedule the same message for later
 * instead of treating it as a terminal failure.
 */
export function isRetryableProviderUnavailable(result: SkillInvocationResult): boolean {
  return result.status === "parse_failure" && result.reason.startsWith(PROVIDER_UNAVAILABLE_RETRY_MARKER);
}

/**
 * Cloudflare's free-tier neuron quota resets on a fixed 00:00 UTC
 * calendar-day boundary, not a rolling 24h window from the failure
 * (confirmed via developers.cloudflare.com/workers-ai/platform/limits/).
 * A small random jitter (0-5 min) spreads out a backlog of messages that
 * all failed on the same day, instead of every deferred retry hammering
 * Cloudflare at the exact same instant the quota resets.
 */
export function nextCloudflareQuotaResetAt(now: Date = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  const jitterMs = Math.random() * 5 * 60_000;
  return new Date(next.getTime() + jitterMs);
}

/**
 * Runs the Gemini fallback and always resolves (never throws, never retries
 * Gemini itself — see gemini.ts for why a 429 there is terminal, not
 * retried). Returns Gemini's own result on success, or a terminal
 * parse_failure describing both the original failure and Gemini's, so the
 * message is recorded but never silently dropped and never made up.
 */
async function tryGeminiFallback(
  context: SkillInvocationContext,
  primaryErr: Error,
  primaryLabel: string,
): Promise<SkillInvocationResult> {
  if (!process.env.GEMINI_API_KEY) {
    console.error(`invokeSkill: ${primaryLabel} failed and no Gemini fallback is configured (GEMINI_API_KEY not set)`, {
      reason: primaryErr.message,
    });
    return {
      status: "parse_failure",
      reason: `provider_unavailable: ${primaryErr.message}; no fallback provider configured`,
      rawOutput: "",
    };
  }

  try {
    const fallbackResult = await invokeGemini(context, SKILL_MARKDOWN);
    console.log(`invokeSkill: Gemini fallback succeeded after ${primaryLabel} failure`, { status: fallbackResult.status });
    return fallbackResult;
  } catch (fallbackErr) {
    const fallbackReason = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    console.error(`invokeSkill: Gemini fallback also failed after ${primaryLabel} failure`, { reason: fallbackReason });
    return {
      status: "parse_failure",
      reason: `provider_unavailable: ${primaryErr.message}; fallback to Gemini also failed: ${fallbackReason}`,
      rawOutput: "",
    };
  }
}

/**
 * Runs the Cloudflare fallback for a failed Qwen primary call. Mirrors the
 * Cloudflare-primary block's own Anthropic-fallback shape below (same
 * retryable-marker treatment when Cloudflare's failure is specifically its
 * own quota exhaustion, since that has a real, known reset time regardless
 * of whether Cloudflare is acting as primary or fallback here) — kept as its
 * own function rather than merged with that block, since "do not modify
 * unrelated functionality" means the existing Cloudflare-primary path stays
 * byte-for-byte as it was.
 */
async function tryCloudflareFallbackForQwen(
  context: SkillInvocationContext,
  primaryErr: Error,
): Promise<SkillInvocationResult> {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    console.error("invokeSkill: Qwen failed and no Cloudflare fallback is configured (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set)", {
      reason: primaryErr.message,
    });
    return {
      status: "parse_failure",
      reason: `provider_unavailable: ${primaryErr.message}; no fallback provider configured`,
      rawOutput: "",
    };
  }

  try {
    const fallbackResult = await invokeCloudflare(context, SKILL_MARKDOWN);
    console.log("invokeSkill: Cloudflare fallback succeeded after Qwen failure", { status: fallbackResult.status });
    return fallbackResult;
  } catch (fallbackErr) {
    const fallbackReason = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    console.error("invokeSkill: Cloudflare fallback also failed after Qwen failure", { reason: fallbackReason });

    // Cloudflare's own quota exhaustion has a known, fixed reset time — worth
    // a scheduled retry here just as it is on the Cloudflare-primary path.
    // Any other Cloudflare failure (bad config, network, etc.) has no such
    // fixed time, so it's a plain terminal parse_failure like Gemini's.
    if (fallbackErr instanceof CloudflareQuotaExceededError) {
      return {
        status: "parse_failure",
        reason: `${PROVIDER_UNAVAILABLE_RETRY_MARKER}: ${primaryErr.message}; fallback to Cloudflare also failed: ${fallbackReason}`,
        rawOutput: "",
      };
    }
    return {
      status: "parse_failure",
      reason: `provider_unavailable: ${primaryErr.message}; fallback to Cloudflare also failed: ${fallbackReason}`,
      rawOutput: "",
    };
  }
}

/**
 * AI_PROVIDER selects which underlying AI API generates replies — "qwen"
 * (primary, default), "cloudflare", "anthropic", or "gemini". Unset or
 * unrecognized falls back to "qwen" rather than guessing. Every provider
 * implements the identical Skill contract (same SKILL_MARKDOWN, same
 * extraction prompt, same SkillDecision validation) — swapping providers is
 * only ever this one env var, never a code change.
 *
 * Three independent fallback paths, kept separate because their retry
 * semantics genuinely differ:
 *
 * - Primary = Qwen (the default): ANY failure — quota, rate limit, or any
 *   other API error — falls back to Cloudflare immediately with the
 *   identical context and Skill (see tryCloudflareFallbackForQwen above).
 * - Primary = Claude: ANY failure falls back to Gemini immediately with the
 *   identical context and Skill. Gemini is a free-tier-only fallback (see
 *   gemini.ts): its own 429s are never retried, and a Gemini failure here is
 *   always a plain terminal parse_failure — never a scheduled retry, since
 *   there's no fixed "available again at" time to reschedule against the way
 *   Cloudflare has.
 * - Primary = Cloudflare: unchanged from before Qwen/Gemini existed — only
 *   its own specific CloudflareQuotaExceededError triggers a fallback (to
 *   Anthropic), and that failure path can reschedule the message for after
 *   Cloudflare's known daily reset. Any other Cloudflare error still
 *   propagates uncaught for Trigger.dev's normal task-level retry.
 */
export async function invokeSkill(
  context: SkillInvocationContext,
): Promise<SkillInvocationResult> {
  const providerName = process.env.AI_PROVIDER ?? "qwen";
  // "qwen" is a real key in PROVIDERS, so this fallback only ever matters for
  // an unrecognized/garbage AI_PROVIDER value — kept as invokeAnthropic
  // (unchanged from before Qwen existed) so that case still pairs correctly
  // with the "!== cloudflare" branch below, which routes to Gemini.
  const provider = PROVIDERS[providerName] ?? invokeAnthropic;

  try {
    return await provider(context, SKILL_MARKDOWN);
  } catch (err) {
    if (providerName === "qwen") {
      const primaryErr = err instanceof Error ? err : new Error(String(err));
      console.error("invokeSkill: primary provider (Qwen) failed, attempting Cloudflare fallback", {
        reason: primaryErr.message,
      });
      return tryCloudflareFallbackForQwen(context, primaryErr);
    }

    if (providerName !== "cloudflare") {
      const primaryErr = err instanceof Error ? err : new Error(String(err));
      console.error("invokeSkill: primary provider (Claude) failed, attempting Gemini fallback", {
        reason: primaryErr.message,
      });
      return tryGeminiFallback(context, primaryErr, "Claude");
    }

    if (!(err instanceof CloudflareQuotaExceededError)) {
      // Not a quota/rate-limit failure — preserve existing behavior and let
      // it propagate for Trigger.dev's normal task-level retry.
      throw err;
    }

    console.error("invokeSkill: Cloudflare unavailable, attempting Anthropic fallback", { reason: err.message });

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        "invokeSkill: no fallback provider available (ANTHROPIC_API_KEY not set) — will retry this message after Cloudflare's daily quota reset instead of generating a reply now",
      );
      return {
        status: "parse_failure",
        reason: `${PROVIDER_UNAVAILABLE_RETRY_MARKER}: ${err.message}; no fallback provider configured`,
        rawOutput: "",
      };
    }

    try {
      const fallbackResult = await invokeAnthropic(context, SKILL_MARKDOWN);
      console.log("invokeSkill: Anthropic fallback succeeded", { status: fallbackResult.status });
      return fallbackResult;
    } catch (fallbackErr) {
      const fallbackReason = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error("invokeSkill: Anthropic fallback also failed", { reason: fallbackReason });
      return {
        status: "parse_failure",
        reason: `provider_unavailable: ${err.message}; fallback to Anthropic also failed: ${fallbackReason}`,
        rawOutput: "",
      };
    }
  }
}
