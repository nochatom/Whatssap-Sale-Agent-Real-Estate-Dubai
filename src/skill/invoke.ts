import { loadSkillMarkdown } from "./skill-file";
import { invokeAnthropic } from "./providers/anthropic";
import { CloudflareQuotaExceededError, invokeCloudflare } from "./providers/cloudflare";
import { invokeGemini } from "./providers/gemini";
import { invokeOxAlpha } from "./providers/oxalpha";
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
  oxalpha: invokeOxAlpha,
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
 * Terminal Ox Alpha stage for invokeDefaultChain (see below). Mirrors the
 * shape of tryCloudflareFallbackForQwen/tryGeminiFallback — own-required-
 * config check, a thrown error becomes a terminal parse_failure, and a
 * RETURNED parse_failure from Ox Alpha itself is passed through as-is, since
 * there's nothing after Ox Alpha in this chain to fall back to.
 * markAsRetryable carries forward whether the earlier Cloudflare failure (if
 * that's what's being reported as primaryErr) was specifically its own quota
 * exhaustion — if so, and Ox Alpha also fails, the combined failure is still
 * marked retryable against Cloudflare's known reset time, same reasoning
 * already used when Cloudflare was the terminal stage.
 */
async function tryOxAlphaFallback(
  context: SkillInvocationContext,
  primaryErr: Error,
  markAsRetryable: boolean,
): Promise<SkillInvocationResult> {
  const retryPrefix = markAsRetryable ? PROVIDER_UNAVAILABLE_RETRY_MARKER : "provider_unavailable";

  if (!process.env.OPENROUTER_API_KEY) {
    console.error("invokeSkill: no Ox Alpha fallback is configured (OPENROUTER_API_KEY not set)", {
      reason: primaryErr.message,
    });
    return {
      status: "parse_failure",
      reason: `${retryPrefix}: ${primaryErr.message}; no fallback provider configured`,
      rawOutput: "",
    };
  }

  try {
    const fallbackResult = await invokeOxAlpha(context, SKILL_MARKDOWN);
    console.log("invokeSkill: Ox Alpha fallback succeeded", { status: fallbackResult.status });
    return fallbackResult;
  } catch (fallbackErr) {
    const fallbackReason = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    console.error("invokeSkill: Ox Alpha fallback also failed", { reason: fallbackReason });
    return {
      status: "parse_failure",
      reason: `${retryPrefix}: ${primaryErr.message}; fallback to Ox Alpha also failed: ${fallbackReason}`,
      rawOutput: "",
    };
  }
}

/**
 * Default routing policy — used only when AI_PROVIDER is unset (see the
 * early-return in invokeSkill below). Priority: Qwen -> Cloudflare -> Ox
 * Alpha. Reordered from the previous Ox Alpha -> Qwen -> Cloudflare default;
 * every explicit AI_PROVIDER selector (qwen/cloudflare/anthropic/gemini/
 * oxalpha) is untouched and keeps its own separate, pre-existing fallback
 * behavior via the generic dispatch further down — this function is ONLY the
 * unset-env-var default policy, not a named provider.
 *
 * Same "a RETURNED parse_failure is ALSO fallback-worthy, not just a thrown
 * error" semantics as the previous default, re-applied to the new order:
 * Qwen and Cloudflare are now the two non-terminal stages; Ox Alpha is now
 * the terminal stage (see tryOxAlphaFallback above), so ITS OWN parse_failure
 * is returned directly — there's nothing after it in this chain.
 */
async function invokeDefaultChain(context: SkillInvocationContext): Promise<SkillInvocationResult> {
  let qwenErr: Error;
  try {
    const result = await invokeQwen(context, SKILL_MARKDOWN);
    if (result.status !== "parse_failure") {
      return result;
    }
    console.error("invokeSkill: Qwen returned an unusable response, attempting Cloudflare fallback", { reason: result.reason });
    qwenErr = new Error(`unusable_response: ${result.reason}`);
  } catch (err) {
    qwenErr = err instanceof Error ? err : new Error(String(err));
    console.error("invokeSkill: primary provider (Qwen) failed, attempting Cloudflare fallback", { reason: qwenErr.message });
  }

  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    console.error(
      "invokeSkill: Qwen failed and no Cloudflare fallback is configured (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set), attempting Ox Alpha",
      { reason: qwenErr.message },
    );
    return tryOxAlphaFallback(context, qwenErr, false);
  }

  let cloudflareErr: Error;
  let cloudflareWasQuotaExceeded = false;
  try {
    const cfResult = await invokeCloudflare(context, SKILL_MARKDOWN);
    if (cfResult.status !== "parse_failure") {
      console.log("invokeSkill: Cloudflare fallback succeeded after Qwen failure", { status: cfResult.status });
      return cfResult;
    }
    console.error("invokeSkill: Cloudflare fallback returned an unusable response, attempting Ox Alpha", { reason: cfResult.reason });
    cloudflareErr = new Error(`unusable_response: ${cfResult.reason}`);
  } catch (err) {
    cloudflareWasQuotaExceeded = err instanceof CloudflareQuotaExceededError;
    cloudflareErr = err instanceof Error ? err : new Error(String(err));
    console.error("invokeSkill: Cloudflare fallback also failed after Qwen failure, attempting Ox Alpha", { reason: cloudflareErr.message });
  }

  return tryOxAlphaFallback(context, cloudflareErr, cloudflareWasQuotaExceeded);
}

/**
 * AI_PROVIDER, when explicitly set, selects one named provider as primary —
 * "qwen", "cloudflare", "anthropic", "gemini", or "oxalpha" — each with its
 * own separate, pre-existing fallback behavior below. When UNSET (the
 * default, and the normal production configuration), invokeDefaultChain
 * above runs instead: Qwen -> Cloudflare -> Ox Alpha, with a returned
 * parse_failure also fallback-worthy, not just a thrown error. Every
 * provider implements the identical Skill contract (same SKILL_MARKDOWN,
 * same extraction prompt, same SkillDecision validation) — swapping which
 * one is used is only ever this one env var, never a code change.
 *
 * The named-selector fallback paths below are unchanged and kept separate
 * because their retry semantics genuinely differ from the default policy:
 *
 * - AI_PROVIDER=qwen: ANY failure — quota, rate limit, or any other API
 *   error — falls back to Cloudflare immediately with the identical context
 *   and Skill (see tryCloudflareFallbackForQwen above). Unlike the default
 *   policy, a returned parse_failure here is terminal, not fallback-worthy —
 *   unchanged from before Ox Alpha existed.
 * - AI_PROVIDER=anthropic (or unrecognized/garbage): ANY failure falls back
 *   to Gemini immediately with the identical context and Skill. Gemini is a
 *   free-tier-only fallback (see gemini.ts): its own 429s are never retried,
 *   and a Gemini failure here is always a plain terminal parse_failure —
 *   never a scheduled retry, since there's no fixed "available again at"
 *   time to reschedule against the way Cloudflare has.
 * - AI_PROVIDER=cloudflare: unchanged from before Qwen/Gemini existed — only
 *   its own specific CloudflareQuotaExceededError triggers a fallback (to
 *   Anthropic), and that failure path can reschedule the message for after
 *   Cloudflare's known daily reset. Any other Cloudflare error still
 *   propagates uncaught for Trigger.dev's normal task-level retry.
 */
export async function invokeSkill(
  context: SkillInvocationContext,
): Promise<SkillInvocationResult> {
  const providerName = process.env.AI_PROVIDER;

  // Default routing policy: only when AI_PROVIDER is genuinely unset. Every
  // new invokeSkill() call is a fresh, stateless invocation with no
  // persisted "current provider" state, so it always starts at Qwen again
  // regardless of what a previous call fell back to.
  if (providerName === undefined) {
    return invokeDefaultChain(context);
  }

  // Unrecognized/garbage AI_PROVIDER falls back to invokeAnthropic (unchanged
  // from before Ox Alpha/Qwen existed) so that case still pairs correctly
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
