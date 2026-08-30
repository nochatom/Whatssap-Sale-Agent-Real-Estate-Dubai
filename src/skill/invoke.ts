import { loadSkillMarkdown } from "./skill-file";
import { CloudflareQuotaExceededError, invokeCloudflare } from "./providers/cloudflare";
import { invokeOxAlpha } from "./providers/oxalpha";
import { invokeQwen } from "./providers/qwen";
import type { SkillInvocationContext, SkillInvocationResult } from "./types";

// Throws at import time if any references/*.md the Skill routes to is missing.
// Phase 1 is expected to throw here until those files exist (see skill-file.ts) —
// this module must never be imported by a code path that runs in production
// without them, since the Skill cannot safely quote a price without offer-config.md.
const SKILL_MARKDOWN = loadSkillMarkdown();

// Prefix identifying a parse_failure caused specifically by "no AI provider
// was reachable" (as opposed to a bad/unparseable output from a provider
// that DID respond). Only this specific failure is worth automatically
// retrying later — see isRetryableProviderUnavailable / send-ai-reply.ts.
// Only ever set when Cloudflare's own quota exhaustion (a known, fixed daily
// reset time) is involved — a plain provider_unavailable has no such fixed
// time to reschedule against.
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
 * Terminal stage: Cloudflare. Own credential pre-check (skips straight to a
 * clean "not configured" failure instead of calling in and letting the
 * provider's own throw surface a less specific message), a thrown error
 * becomes a terminal parse_failure, and a RETURNED parse_failure from
 * Cloudflare is passed through as-is — there's nothing after it in this
 * chain to fall back to. Cloudflare's own CloudflareQuotaExceededError still
 * marks the combined failure retryable against its known daily UTC reset,
 * same as when Cloudflare was the primary stage in the old design — that
 * fact doesn't change just because it moved to the terminal position.
 */
async function tryCloudflareTerminal(
  context: SkillInvocationContext,
  primaryErr: Error,
  markAsRetryable: boolean,
): Promise<SkillInvocationResult> {
  const retryPrefix = markAsRetryable ? PROVIDER_UNAVAILABLE_RETRY_MARKER : "provider_unavailable";

  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    console.error(
      "invokeSkill: no Cloudflare fallback is configured (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set)",
      { reason: primaryErr.message },
    );
    return {
      status: "parse_failure",
      reason: `${retryPrefix}: ${primaryErr.message}; no fallback provider configured`,
      rawOutput: "",
    };
  }

  try {
    const fallbackResult = await invokeCloudflare(context, SKILL_MARKDOWN);
    console.log("invokeSkill: Cloudflare fallback succeeded", { status: fallbackResult.status });
    return fallbackResult;
  } catch (fallbackErr) {
    const fallbackReason = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    console.error("invokeSkill: Cloudflare fallback also failed", { reason: fallbackReason });

    const cloudflareWasQuotaExceeded = fallbackErr instanceof CloudflareQuotaExceededError;
    return {
      status: "parse_failure",
      reason: `${markAsRetryable || cloudflareWasQuotaExceeded ? PROVIDER_UNAVAILABLE_RETRY_MARKER : "provider_unavailable"}: ${primaryErr.message}; fallback to Cloudflare also failed: ${fallbackReason}`,
      rawOutput: "",
    };
  }
}

/**
 * Middle stage: Ox Alpha. Own credential pre-check, same shape as
 * tryCloudflareTerminal above. On any failure (thrown or a returned
 * parse_failure), moves to Cloudflare with the identical context and Skill
 * markdown Ox Alpha itself received.
 */
async function tryOxAlphaFallback(
  context: SkillInvocationContext,
  primaryErr: Error,
): Promise<SkillInvocationResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("invokeSkill: no Ox Alpha fallback is configured (OPENROUTER_API_KEY not set), attempting Cloudflare", {
      reason: primaryErr.message,
    });
    return tryCloudflareTerminal(context, primaryErr, false);
  }

  try {
    const result = await invokeOxAlpha(context, SKILL_MARKDOWN);
    if (result.status !== "parse_failure") {
      console.log("invokeSkill: Ox Alpha fallback succeeded", { status: result.status });
      return result;
    }
    console.error("invokeSkill: Ox Alpha fallback returned an unusable response, attempting Cloudflare", { reason: result.reason });
    return tryCloudflareTerminal(context, new Error(`unusable_response: ${result.reason}`), false);
  } catch (err) {
    const oxAlphaErr = err instanceof Error ? err : new Error(String(err));
    console.error("invokeSkill: Ox Alpha fallback also failed, attempting Cloudflare", { reason: oxAlphaErr.message });
    return tryCloudflareTerminal(context, oxAlphaErr, false);
  }
}

/**
 * The one and only routing policy: Qwen -> Ox Alpha -> Cloudflare, for
 * EVERY invokeSkill() call. AI_PROVIDER is intentionally not read anywhere
 * in this file — the prior design let it pin routing to a single named
 * provider with only one narrow fallback partner each (Cloudflare->
 * Anthropic, Qwen->Cloudflare only, Ox Alpha essentially unreachable as a
 * fallback target at all), and in production that meant an explicit
 * AI_PROVIDER=cloudflare silently removed Qwen and Ox Alpha from the
 * picture entirely — both fully configured and unused — while Cloudflare's
 * own fallback partner (Anthropic) was never provisioned. A single
 * provider's quota limit became a full outage instead of a non-event the
 * other two configured providers would have absorbed. Fixed at the
 * routing level, not by touching the AI_PROVIDER value itself: this chain
 * always runs, regardless of what (if anything) AI_PROVIDER is set to.
 *
 * Ox Alpha demoted out of the primary slot (2026-08-30): it is an
 * anonymized, undocumented-capability model ("stealth/ox-alpha" on
 * OpenRouter) confirmed via a real production incident to return raw JSON
 * instead of the natural-language reasoning the Skill's prompt expects, and
 * to disregard build-prompt.ts's deterministic per-turn guards (the
 * fresh-turn and repetition checks) that Qwen has been observed following
 * reliably. Kept as the middle fallback rather than removed outright — it's
 * still a real, working provider when Qwen itself is unavailable, and a
 * degraded reply beats none.
 *
 * Every call is fresh and stateless — it always starts at Qwen again
 * regardless of what a previous call fell back to. A RETURNED
 * parse_failure is fallback-worthy here too, not just a thrown error, same
 * as the prior default chain's semantics.
 */
async function invokeProviderChain(context: SkillInvocationContext): Promise<SkillInvocationResult> {
  let qwenErr: Error;
  try {
    const result = await invokeQwen(context, SKILL_MARKDOWN);
    if (result.status !== "parse_failure") {
      return result;
    }
    console.error("invokeSkill: Qwen returned an unusable response, attempting Ox Alpha fallback", { reason: result.reason });
    qwenErr = new Error(`unusable_response: ${result.reason}`);
  } catch (err) {
    qwenErr = err instanceof Error ? err : new Error(String(err));
    console.error("invokeSkill: primary provider (Qwen) failed, attempting Ox Alpha fallback", { reason: qwenErr.message });
  }

  return tryOxAlphaFallback(context, qwenErr);
}

export async function invokeSkill(context: SkillInvocationContext): Promise<SkillInvocationResult> {
  return invokeProviderChain(context);
}
