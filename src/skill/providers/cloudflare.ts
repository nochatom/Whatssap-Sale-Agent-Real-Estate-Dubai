import OpenAI from "openai";

import { buildSkillInput } from "../build-prompt";
import { SKILL_DECISION_JSON_SCHEMA, parseExtractionOutput } from "../parse-decision";
import type { SkillProvider } from "./types";

// Strongest model on Cloudflare's own documented JSON-mode-compatible
// allow-list (only 9 specific models support structured output at all —
// confirmed via developers.cloudflare.com/workers-ai/features/json-mode/ —
// the newer/larger @cf/openai/gpt-oss-120b is notably NOT on that list).
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Thrown instead of returning a parse_failure when Cloudflare rejects the
 * request with a 429 (rate limit or the 10,000-neuron/day free-tier quota,
 * error code 4006 — both surface as OpenAI.RateLimitError). This is an
 * availability failure, not a bad-output failure: retrying against the same
 * exhausted daily quota cannot succeed until Cloudflare's 00:00 UTC reset,
 * so invoke.ts catches this specific type to route to a fallback provider
 * instead of burning retries or crashing the task.
 */
export class CloudflareQuotaExceededError extends Error {
  constructor(cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Cloudflare Workers AI rate-limited or quota-exceeded: ${causeMessage}`);
    this.name = "CloudflareQuotaExceededError";
  }
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof OpenAI.RateLimitError;
}

/**
 * Cloudflare Workers AI exposes an OpenAI-compatible endpoint, so the same
 * `openai` SDK used for the (now-removed) NVIDIA provider is reused here
 * too, just repointed at Cloudflare's baseURL. CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_API_TOKEN are read explicitly here — the only place in the
 * codebase that reads them — and neither is ever logged.
 */
function client(): OpenAI {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set — required when AI_PROVIDER=cloudflare",
    );
  }
  return new OpenAI({
    apiKey: apiToken,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
  });
}

/**
 * Single call: the model reasons through the full Skill pipeline AND emits
 * strict-schema JSON in one pass, instead of a separate free-form prose call
 * followed by a second extraction call. Measured (real Cloudflare calls,
 * same 7 test scenarios used to validate the original two-call provider,
 * 2026-08-20): ~40% faster (~19.4s -> ~11.6s avg per request) with no
 * pricing errors, no lost conversation memory, and no invented facts on
 * 5 of 7 scenarios — the two soft misses found (an "unknown"-classification
 * slip and one skipped objection-acknowledgment) are style/compliance
 * nuances, not the hard factual errors that ruled out the 8B model. Chosen
 * over staying two-call because production was, at the time of this change,
 * also hitting Cloudflare's daily quota — fewer total calls per reply also
 * means the existing free-tier budget covers more real replies per day.
 */
export const invokeCloudflare: SkillProvider = async (context, skillMarkdown) => {
  const openai = client();
  const t0 = Date.now();

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        { role: "system", content: skillMarkdown },
        { role: "user", content: buildSkillInput(context) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "skill_decision", schema: SKILL_DECISION_JSON_SCHEMA, strict: true },
      },
    });
  } catch (err) {
    if (isRateLimitError(err)) {
      throw new CloudflareQuotaExceededError(err);
    }
    // Any other failure (network blip, 5xx, etc.) keeps the pre-existing
    // behavior of propagating uncaught, so Trigger.dev's normal task-level
    // retry still applies for genuinely transient errors.
    throw err;
  }
  const totalMs = Date.now() - t0;
  const timingsMs = { proseCallMs: totalMs, extractionCallMs: 0, totalMs };

  const responseText = response.choices[0]?.message?.content ?? "";
  if (!responseText) {
    return { status: "parse_failure", reason: "Skill call returned no content", rawOutput: "", timingsMs };
  }

  // Cloudflare's own docs are explicit that JSON Mode is not guaranteed —
  // a schema-conformant request can still fail with "JSON Mode couldn't be
  // met," surfaced here as malformed/incomplete content rather than a thrown
  // API error, same as the two-call provider's extraction stage handled it.
  const parsed = parseExtractionOutput(responseText);
  if (!parsed.ok) {
    return { status: "parse_failure", reason: parsed.reason, rawOutput: responseText, timingsMs };
  }

  return { status: "success", decision: parsed.decision, rawOutput: responseText, timingsMs };
};
